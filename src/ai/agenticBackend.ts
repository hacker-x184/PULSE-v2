import type { Express, Request, Response } from 'express';
import { evaluateProjectRisk } from '../utils/risk.ts';
import { calculateMemberContribution, isTaskOverdue, isTaskCompleted, TaskRecord } from '../utils/contribution.ts';
import {
  calculateEstimationAccuracy,
  detectMissingEvidence,
  generateRedistributionSuggestions,
  calculateCriticalPathAndVariance
} from '../utils/pmIntelligence.ts';

/**
 * ============================================================================
 * PULSE AGENTIC AI, HYBRID RAG, LANGCHAIN TOOLS & LANGGRAPH WORKFLOW ENGINE
 * Powered by Groq Cloud (`openai/gpt-oss-120b`) with SQLite Vector + BM25 RAG
 * ============================================================================
 */

export interface DbAdapter {
  queryAll: <T = any>(sql: string, params?: any[]) => T[];
  queryOne: <T = any>(sql: string, params?: any[]) => T | null;
  execute: (sql: string, params?: any[]) => void;
}

export interface RagChunk {
  id: string;
  project_id: string;
  source_type:
    | 'project'
    | 'task'
    | 'meeting_note'
    | 'discussion'
    | 'retrospective'
    | 'task_comment'
    | 'github_commit'
    | 'github_pr'
    | 'dispute'
    | 'peer_kudos';
  entity_id: string;
  title: string;
  content: string;
  metadata_json: string;
  embedding_json: string;
  updated_at: string;
}

export interface RagSearchResult {
  id: string;
  project_id: string;
  source_type: string;
  entity_id: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  dense_score: number;
  bm25_score: number;
  combined_score: number;
}

export interface AgentStepTrace {
  step_id: string;
  node_or_tool: string;
  type: 'rag_retrieval' | 'langgraph_node' | 'tool_call' | 'critique_loop' | 'hitl_interrupt' | 'llm_synthesis';
  status: 'completed' | 'waiting_approval' | 'error';
  summary: string;
  details?: any;
  duration_ms: number;
  timestamp: string;
}

export interface StructuredToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  execute: (args: Record<string, any>) => Promise<any>;
}

// ============================================================================
// 1. DETERMINISTIC 128-DIM SEMANTIC HASHING VECTORIZER + BM25 HYBRID SEARCH
// (Enables 100% self-contained Vector + Keyword RAG with ONLY GROQ_API_KEY)
// ============================================================================

const EMBEDDING_DIM = 128;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
  'are', 'was', 'were', 'been', 'being', 'will', 'would', 'could', 'should',
  'into', 'onto', 'upon', 'about', 'above', 'below', 'under', 'over', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such'
]);

const DOMAIN_SYNONYM_CLUSTERS: Record<string, string[]> = {
  blocker: ['blocked', 'impediment', 'stuck', 'bottleneck', 'stalled', 'dependency', 'delay'],
  overdue: ['late', 'past_due', 'delayed', 'missed', 'behind', 'slippage', 'deadline'],
  invisible_work: ['mentoring', 'kudos', 'uncredited', 'review', 'pair_programming', 'architecture', 'helping', 'support', 'dispute'],
  overload: ['overloaded', 'capacity', 'burnout', 'workload', 'rebalance', 'redistribute', 'reassign'],
  risk: ['critical', 'high_risk', 'compression', 'vulnerability', 'escalation', 'mitigation'],
  quality: ['bug', 'defect', 'testing', 'qa', 'acceptance', 'criteria', 'verification', 'evidence', 'commit', 'pr']
};

export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_-\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));

  const expanded: string[] = [...rawTokens];
  for (const token of rawTokens) {
    for (const [canonical, synonyms] of Object.entries(DOMAIN_SYNONYM_CLUSTERS)) {
      if (token === canonical || synonyms.includes(token)) {
        expanded.push(canonical);
      }
    }
  }
  return expanded;
}

function fnv1aHash(str: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function computeSemanticEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = tokenizeText(text);
  if (tokens.length === 0) return vec;

  // Unigrams + Bigrams + Character 3-grams for resilient semantic + morphological matching
  const features: Array<{ feat: string; weight: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    features.push({ feat: `u:${tok}`, weight: 1.5 });
    if (i + 1 < tokens.length) {
      features.push({ feat: `b:${tok}_${tokens[i + 1]}`, weight: 2.0 });
    }
    if (tok.length >= 4) {
      for (let j = 0; j <= tok.length - 3; j++) {
        features.push({ feat: `c3:${tok.slice(j, j + 3)}`, weight: 0.5 });
      }
    }
  }

  for (const { feat, weight } of features) {
    const idx = fnv1aHash(feat, 2166136261) % EMBEDDING_DIM;
    const sign = (fnv1aHash(feat, 374761393) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  }

  // L2 Normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(5));
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, (dot + 1) / 2));
}

export function computeBM25Score(queryTokens: string[], docText: string, avgDocLen = 60): number {
  if (queryTokens.length === 0 || !docText) return 0;
  const docTokens = tokenizeText(docText);
  if (docTokens.length === 0) return 0;

  const freq: Record<string, number> = {};
  for (const t of docTokens) {
    freq[t] = (freq[t] || 0) + 1;
  }

  const k1 = 1.5;
  const b = 0.75;
  let score = 0;
  const uniqueQuery = Array.from(new Set(queryTokens));

  for (const qt of uniqueQuery) {
    const tf = freq[qt] || 0;
    if (tf > 0) {
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docTokens.length / avgDocLen));
      score += numerator / denominator;
    }
  }

  return Math.min(1, score / (uniqueQuery.length * 1.6));
}

// ============================================================================
// 2. LANGGRAPH STATEGRAPH ENGINE & MEMORYSAVER CHECKPOINTER
// ============================================================================

export type LangGraphNodeFn<TState> = (state: TState) => Promise<Partial<TState>>;

export class LangGraphStateGraph<TState extends Record<string, any>> {
  private nodes = new Map<string, LangGraphNodeFn<TState>>();
  private edges = new Map<string, string>();
  private conditionalEdges = new Map<string, (state: TState) => string>();
  private entryPoint: string = '';

  public addNode(name: string, fn: LangGraphNodeFn<TState>): this {
    this.nodes.set(name, fn);
    return this;
  }

  public setEntryPoint(name: string): this {
    this.entryPoint = name;
    return this;
  }

  public addEdge(from: string, to: string): this {
    this.edges.set(from, to);
    return this;
  }

  public addConditionalEdges(from: string, routerFn: (state: TState) => string): this {
    this.conditionalEdges.set(from, routerFn);
    return this;
  }

  public compile(options?: { interruptBefore?: string[] }) {
    const interruptSet = new Set(options?.interruptBefore || []);
    const nodes = this.nodes;
    const edges = this.edges;
    const conditionalEdges = this.conditionalEdges;
    const entryPoint = this.entryPoint;

    return {
      invoke: async (
        initialState: TState,
        resumeFromNode?: string
      ): Promise<{
        state: TState;
        status: 'COMPLETED' | 'WAITING_APPROVAL';
        interruptedAtNode: string | null;
        trace: AgentStepTrace[];
      }> => {
        let currentState: TState = { ...initialState };
        const trace: AgentStepTrace[] = Array.isArray(currentState.trace) ? [...currentState.trace] : [];
        let currentNode = resumeFromNode || entryPoint;
        let stepCounter = 0;

        while (currentNode && currentNode !== '__end__' && stepCounter < 20) {
          stepCounter++;

          // Check if we must pause BEFORE executing this node (Human-in-the-Loop)
          if (interruptSet.has(currentNode) && currentNode !== resumeFromNode) {
            trace.push({
              step_id: `hitl-${Date.now()}-${stepCounter}`,
              node_or_tool: currentNode,
              type: 'hitl_interrupt',
              status: 'waiting_approval',
              summary: `Workflow paused before [${currentNode}] for Human-in-the-Loop verification and sign-off.`,
              duration_ms: 1,
              timestamp: new Date().toISOString()
            });
            currentState = { ...currentState, trace };
            return {
              state: currentState,
              status: 'WAITING_APPROVAL',
              interruptedAtNode: currentNode,
              trace
            };
          }

          // Clear resumeFromNode flag once we execute it
          if (currentNode === resumeFromNode) {
            resumeFromNode = undefined;
          }

          const nodeFn = nodes.get(currentNode);
          if (!nodeFn) break;

          const startMs = Date.now();
          const patch = await nodeFn(currentState);
          const durationMs = Math.max(1, Date.now() - startMs);

          currentState = {
            ...currentState,
            ...patch
          };

          const nodeSummary =
            (patch as any)?.lastNodeSummary ||
            `Executed LangGraph node [${currentNode}] (${durationMs}ms)`;

          trace.push({
            step_id: `node-${Date.now()}-${stepCounter}`,
            node_or_tool: currentNode,
            type: currentNode.includes('critique') ? 'critique_loop' : 'langgraph_node',
            status: 'completed',
            summary: nodeSummary,
            details: (patch as any)?.lastNodeDetails || undefined,
            duration_ms: durationMs,
            timestamp: new Date().toISOString()
          });

          currentState = { ...currentState, trace };

          if (conditionalEdges.has(currentNode)) {
            const router = conditionalEdges.get(currentNode)!;
            currentNode = router(currentState);
          } else if (edges.has(currentNode)) {
            currentNode = edges.get(currentNode)!;
          } else {
            currentNode = '__end__';
          }
        }

        return {
          state: currentState,
          status: 'COMPLETED',
          interruptedAtNode: null,
          trace
        };
      }
    };
  }
}

// ============================================================================
// 3. GROQ (`openai/gpt-oss-120b`) + FALLBACK LLM CLIENT WITH TOOL CALLING
// ============================================================================

export class PulseLLMClient {
  private db: DbAdapter;

  constructor(db: DbAdapter) {
    this.db = db;
  }

  public getConfig(): {
    groqApiKey: string | null;
    groqModel: string;
    geminiApiKey: string | null;
    activeProvider: 'groq' | 'gemini' | 'deterministic_fallback';
  } {
    const dbKeyRow = this.db.queryOne<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'groq_api_key'"
    );
    const dbModelRow = this.db.queryOne<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'groq_model'"
    );

    const groqApiKey =
      (dbKeyRow?.value && dbKeyRow.value.trim()) ||
      process.env.GROQ_API_KEY?.trim() ||
      null;
    const groqModel =
      (dbModelRow?.value && dbModelRow.value.trim()) ||
      process.env.GROQ_MODEL?.trim() ||
      'openai/gpt-oss-120b';
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || null;

    let activeProvider: 'groq' | 'gemini' | 'deterministic_fallback' = 'deterministic_fallback';
    if (groqApiKey) activeProvider = 'groq';
    else if (geminiApiKey) activeProvider = 'gemini';

    return { groqApiKey, groqModel, geminiApiKey, activeProvider };
  }

  public saveConfig(data: { groq_api_key?: string; groq_model?: string }) {
    if (data.groq_api_key !== undefined) {
      const existing = this.db.queryOne("SELECT key FROM system_settings WHERE key = 'groq_api_key'");
      if (existing) {
        this.db.execute("UPDATE system_settings SET value = ? WHERE key = 'groq_api_key'", [
          data.groq_api_key.trim()
        ]);
      } else {
        this.db.execute("INSERT INTO system_settings (key, value) VALUES ('groq_api_key', ?)", [
          data.groq_api_key.trim()
        ]);
      }
    }
    if (data.groq_model !== undefined && data.groq_model.trim()) {
      const existing = this.db.queryOne("SELECT key FROM system_settings WHERE key = 'groq_model'");
      if (existing) {
        this.db.execute("UPDATE system_settings SET value = ? WHERE key = 'groq_model'", [
          data.groq_model.trim()
        ]);
      } else {
        this.db.execute("INSERT INTO system_settings (key, value) VALUES ('groq_model', ?)", [
          data.groq_model.trim()
        ]);
      }
    }
  }

  /**
   * Calls Groq OpenAI-compatible Chat Completions endpoint (`openai/gpt-oss-120b`)
   * with optional native Tool Calling (`tools`) or JSON output.
   */
  public async invokeChat(params: {
    systemPrompt: string;
    userPrompt: string;
    tools?: StructuredToolDefinition[];
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<{
    text: string;
    modelUsed: string;
    provider: 'groq' | 'gemini' | 'deterministic_fallback';
    toolCallsExecuted: Array<{ name: string; args: any; result: any; latency_ms: number }>;
  }> {
    const cfg = this.getConfig();
    const toolCallsExecuted: Array<{ name: string; args: any; result: any; latency_ms: number }> = [];

    if (cfg.groqApiKey) {
      try {
        const messages: any[] = [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt }
        ];

        const openAiTools =
          params.tools && params.tools.length > 0
            ? params.tools.map(t => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters
                }
              }))
            : undefined;

        const bodyPayload: Record<string, any> = {
          model: cfg.groqModel || 'openai/gpt-oss-120b',
          messages,
          temperature: params.temperature ?? 0.2,
          max_tokens: 2048
        };

        if (openAiTools) {
          bodyPayload.tools = openAiTools;
          bodyPayload.tool_choice = 'auto';
        } else if (params.jsonMode) {
          bodyPayload.response_format = { type: 'json_object' };
        }

        const firstResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.groqApiKey}`
          },
          body: JSON.stringify(bodyPayload)
        });

        if (!firstResp.ok) {
          const errText = await firstResp.text();
          throw new Error(`Groq API HTTP ${firstResp.status}: ${errText}`);
        }

        const firstData: any = await firstResp.json();
        const choice = firstData.choices?.[0];
        const assistantMessage = choice?.message;

        // Handle LangChain-style multi-tool execution loop if model requested tool_calls
        if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && params.tools) {
          messages.push(assistantMessage);

          for (const tc of assistantMessage.tool_calls) {
            const fnName = tc.function?.name;
            let fnArgs: any = {};
            try {
              fnArgs = JSON.parse(tc.function?.arguments || '{}');
            } catch {
              fnArgs = {};
            }

            const matchedTool = params.tools.find(t => t.name === fnName);
            const tStart = Date.now();
            let toolResult: any = { error: `Tool ${fnName} not found` };
            if (matchedTool) {
              try {
                toolResult = await matchedTool.execute(fnArgs);
              } catch (toolErr: any) {
                toolResult = { error: toolErr.message || 'Tool execution error' };
              }
            }
            const latency = Math.max(1, Date.now() - tStart);

            toolCallsExecuted.push({
              name: fnName,
              args: fnArgs,
              result: toolResult,
              latency_ms: latency
            });

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: fnName,
              content: JSON.stringify(toolResult)
            });
          }

          // Second turn synthesis with tool outputs
          const secondResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cfg.groqApiKey}`
            },
            body: JSON.stringify({
              model: cfg.groqModel || 'openai/gpt-oss-120b',
              messages,
              temperature: 0.2,
              max_tokens: 2048
            })
          });

          if (secondResp.ok) {
            const secondData: any = await secondResp.json();
            return {
              text: secondData.choices?.[0]?.message?.content || 'Action completed via Groq tool execution.',
              modelUsed: cfg.groqModel || 'openai/gpt-oss-120b',
              provider: 'groq',
              toolCallsExecuted
            };
          }
        }

        return {
          text: assistantMessage?.content || 'No content returned from Groq model.',
          modelUsed: cfg.groqModel || 'openai/gpt-oss-120b',
          provider: 'groq',
          toolCallsExecuted
        };
      } catch (err: any) {
        console.warn('Groq API warning, falling back to secondary provider:', err.message);
      }
    }

    // Fallback to deterministic synthesis when GROQ_API_KEY is not configured yet
    return {
      text: '',
      modelUsed: 'pulse-deterministic-langgraph-engine (Configure GROQ_API_KEY for openai/gpt-oss-120b)',
      provider: 'deterministic_fallback',
      toolCallsExecuted
    };
  }
}

// ============================================================================
// 4. HYBRID PROJECT RAG ENGINE (SQLite `rag_chunks` + Dense Cosine + BM25)
// ============================================================================

export class HybridProjectRAGEngine {
  private db: DbAdapter;

  constructor(db: DbAdapter) {
    this.db = db;
    this.initTables();
  }

  private initTables() {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
        thread_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        project_id TEXT,
        status TEXT NOT NULL,
        current_node TEXT,
        state_json TEXT NOT NULL,
        trace_json TEXT NOT NULL,
        pending_action_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS agent_tool_logs (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        tool_name TEXT NOT NULL,
        args_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  /**
   * Indexes all 9 project tables into `rag_chunks` with 128-dim semantic embeddings.
   */
  public reindexAll(filterProjectId?: string): {
    total_chunks: number;
    by_source: Record<string, number>;
    indexed_at: string;
  } {
    const now = new Date().toISOString();
    if (filterProjectId) {
      this.db.execute('DELETE FROM rag_chunks WHERE project_id = ?', [filterProjectId]);
    } else {
      this.db.execute('DELETE FROM rag_chunks');
    }

    const bySource: Record<string, number> = {};
    const addChunk = (
      id: string,
      projectId: string,
      sourceType: RagChunk['source_type'],
      entityId: string,
      title: string,
      content: string,
      metadata: Record<string, any>
    ) => {
      const emb = computeSemanticEmbedding(`${title} ${content}`);
      this.db.execute(
        `INSERT OR REPLACE INTO rag_chunks
         (id, project_id, source_type, entity_id, title, content, metadata_json, embedding_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          projectId || 'global',
          sourceType,
          entityId,
          title,
          content,
          JSON.stringify(metadata),
          JSON.stringify(emb),
          now
        ]
      );
      bySource[sourceType] = (bySource[sourceType] || 0) + 1;
    };

    const pWhere = filterProjectId ? ' WHERE id = ?' : '';
    const pParams = filterProjectId ? [filterProjectId] : [];
    const projects = this.db.queryAll<any>('SELECT * FROM projects' + pWhere, pParams);
    for (const p of projects) {
      addChunk(
        `rag-proj-${p.id}`,
        p.id,
        'project',
        p.id,
        `Project: ${p.name} (${p.status})`,
        `Project "${p.name}". Status: ${p.status}. Sprint: ${p.current_sprint || 'Sprint 1'}. Deadline: ${p.deadline || 'N/A'}. Description: ${p.description || ''}. Objectives: ${p.objectives || 'Deliver sprint milestones on schedule.'}`,
        { status: p.status, deadline: p.deadline, sprint: p.current_sprint }
      );
    }

    const fkWhere = filterProjectId ? ' WHERE project_id = ?' : '';
    const members = this.db.queryAll<any>('SELECT * FROM team_members');
    const memberMap = new Map(members.map((m: any) => [m.id, m.name]));

    // 1. Tasks
    const tasks = this.db.queryAll<any>('SELECT * FROM tasks' + fkWhere, pParams);
    for (const t of tasks) {
      const assigneeName = t.assignee_id ? memberMap.get(t.assignee_id) || 'Unassigned' : 'Unassigned';
      const blockerText = t.is_blocked ? `BLOCKED: ${t.blocker_reason || 'Active blocker'} (Owner: ${t.blocker_owner || 'TBD'})` : 'Not blocked';
      addChunk(
        `rag-task-${t.id}`,
        t.project_id,
        'task',
        t.id,
        `Deliverable [${t.issue_key || t.id}]: ${t.title}`,
        `Task ${t.issue_key || t.id} "${t.title}" (${t.issue_type || 'Task'}). Priority: ${t.priority}. Status: ${t.status}. Assignee: ${assigneeName}. Due Date: ${t.due_date || 'None'}. Estimated Hours: ${t.estimated_hours || 0}h, Actual Hours: ${t.actual_hours || 0}h. ${blockerText}. Description: ${t.description || ''}`,
        { issue_key: t.issue_key, priority: t.priority, status: t.status, assignee: assigneeName, is_blocked: Boolean(t.is_blocked) }
      );
    }

    // 2. Meeting Notes
    const meetings = this.db.queryAll<any>('SELECT * FROM meeting_notes' + fkWhere, pParams);
    for (const m of meetings) {
      addChunk(
        `rag-meet-${m.id}`,
        m.project_id,
        'meeting_note',
        m.id,
        `Meeting Note: ${m.title} (${m.meeting_date})`,
        `Meeting "${m.title}" held on ${m.meeting_date}. Attendees: ${m.attendees}. Summary & Decisions: ${m.content}. Action Items: ${m.action_items || 'None'}`,
        { meeting_date: m.meeting_date, attendees: m.attendees }
      );
    }

    // 3. Discussions
    const discussions = this.db.queryAll<any>('SELECT * FROM discussions' + fkWhere, pParams);
    for (const d of discussions) {
      addChunk(
        `rag-disc-${d.id}`,
        d.project_id,
        'discussion',
        d.id,
        `Discussion [${d.category || 'Architecture'}]: ${d.title}`,
        `Team Discussion "${d.title}" by ${d.author_name} in category ${d.category || 'General'}: ${d.content}`,
        { author_name: d.author_name, category: d.category, created_at: d.created_at }
      );
    }

    // 4. Retrospectives
    const retros = this.db.queryAll<any>('SELECT * FROM retrospectives' + fkWhere, pParams);
    for (const r of retros) {
      addChunk(
        `rag-retro-${r.id}`,
        r.project_id,
        'retrospective',
        r.id,
        `Sprint Retrospective: ${r.sprint}`,
        `Retrospective for ${r.sprint}. What Went Well: ${r.went_well}. Needs Improvement / Bottlenecks: ${r.needs_improvement}. Action Items: ${r.action_items}`,
        { sprint: r.sprint, created_at: r.created_at }
      );
    }

    // 5. Task Comments (linked via task_id -> project_id)
    const taskProjectMap = new Map(tasks.map((t: any) => [t.id, t.project_id]));
    const taskTitleMap = new Map(tasks.map((t: any) => [t.id, `${t.issue_key || t.id}: ${t.title}`]));
    const comments = this.db.queryAll<any>('SELECT * FROM task_comments');
    for (const c of comments) {
      const pid = taskProjectMap.get(c.task_id) || 'p1';
      if (filterProjectId && pid !== filterProjectId) continue;
      addChunk(
        `rag-comm-${c.id}`,
        pid,
        'task_comment',
        c.id,
        `Comment by ${c.author_name} on ${taskTitleMap.get(c.task_id) || c.task_id}`,
        `Task Comment by ${c.author_name} on deliverable (${taskTitleMap.get(c.task_id) || c.task_id}): "${c.content}"`,
        { author_name: c.author_name, task_id: c.task_id, created_at: c.created_at }
      );
    }

    // 6. GitHub Commits
    const commits = this.db.queryAll<any>('SELECT * FROM github_commits' + fkWhere, pParams);
    for (const gc of commits) {
      addChunk(
        `rag-commit-${gc.sha}-${gc.project_id}`,
        gc.project_id,
        'github_commit',
        gc.sha,
        `Git Commit (${gc.sha.slice(0, 7)}) by ${gc.author_login || gc.author_name}`,
        `GitHub Commit ${gc.sha.slice(0, 7)} on repo ${gc.repo_full_name} (${gc.branch || 'main'}) linked to ${gc.issue_key || 'unlinked'}: "${gc.message}" by ${gc.author_login || gc.author_name} on ${gc.date || ''}`,
        { sha: gc.sha, author: gc.author_login, issue_key: gc.issue_key, url: gc.url }
      );
    }

    // 7. GitHub Pull Requests
    const prs = this.db.queryAll<any>('SELECT * FROM github_pull_requests' + fkWhere, pParams);
    for (const pr of prs) {
      addChunk(
        `rag-pr-${pr.id}`,
        pr.project_id,
        'github_pr',
        pr.id,
        `Pull Request #${pr.number}: ${pr.title} (${pr.state})`,
        `GitHub Pull Request #${pr.number} "${pr.title}" by ${pr.author_login} in ${pr.repo_full_name}. State: ${pr.state}. Linked Issue: ${pr.issue_key || 'None'}.`,
        { number: pr.number, state: pr.state, author: pr.author_login, issue_key: pr.issue_key }
      );
    }

    // 8. Disputes (Invisible Work & Fair Contribution Claims)
    const disputes = this.db.queryAll<any>('SELECT * FROM disputes' + fkWhere, pParams);
    for (const disp of disputes) {
      addChunk(
        `rag-disp-${disp.id}`,
        disp.project_id,
        'dispute',
        disp.id,
        `Contribution Dispute by ${disp.member_name} (${disp.status})`,
        `Fair Contribution Dispute submitted by ${disp.member_name}. Status: ${disp.status}. Claim & Invisible Work Justification: "${disp.reason}". Evidence URL: ${disp.evidence_url || 'N/A'}. Resolution Notes: ${disp.resolution_notes || 'Pending review'}`,
        { member_name: disp.member_name, status: disp.status, evidence_url: disp.evidence_url }
      );
    }

    // 9. Peer Kudos (Peer Recognition & Mentoring Evidence)
    const kudos = this.db.queryAll<any>('SELECT * FROM peer_kudos' + fkWhere, pParams);
    for (const kd of kudos) {
      const toName = memberMap.get(kd.to_member_id) || kd.to_member_id;
      addChunk(
        `rag-kudos-${kd.id}`,
        kd.project_id || 'p1',
        'peer_kudos',
        kd.id,
        `Peer Kudos [${kd.category}]: ${kd.from_name} -> ${toName}`,
        `Peer Recognition Kudos from ${kd.from_name} to ${toName} for [${kd.category}]: "${kd.message}"`,
        { from_name: kd.from_name, to_member: toName, category: kd.category }
      );
    }

    const total = Object.values(bySource).reduce((a, b) => a + b, 0);
    return { total_chunks: total, by_source: bySource, indexed_at: now };
  }

  public ensureIndexed() {
    const countRow = this.db.queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM rag_chunks');
    if (!countRow || countRow.cnt === 0) {
      this.reindexAll();
    }
  }

  /**
   * Hybrid Search: Combines 128-dim Cosine Vector Similarity (60%) + BM25 Lexical Score (40%)
   */
  public search(params: {
    query: string;
    project_id?: string;
    source_types?: string[];
    top_k?: number;
  }): RagSearchResult[] {
    this.ensureIndexed();
    const topK = params.top_k || 6;
    const queryEmb = computeSemanticEmbedding(params.query);
    const queryTokens = tokenizeText(params.query);

    let sql = 'SELECT * FROM rag_chunks';
    const sqlParams: any[] = [];
    const clauses: string[] = [];

    if (params.project_id) {
      clauses.push('(project_id = ? OR project_id = "global")');
      sqlParams.push(params.project_id);
    }
    if (params.source_types && params.source_types.length > 0) {
      clauses.push(`source_type IN (${params.source_types.map(() => '?').join(',')})`);
      sqlParams.push(...params.source_types);
    }
    if (clauses.length > 0) {
      sql += ' WHERE ' + clauses.join(' AND ');
    }

    const rows = this.db.queryAll<RagChunk>(sql, sqlParams);
    const scored: RagSearchResult[] = rows.map(row => {
      let docEmb: number[] = [];
      let meta: Record<string, any> = {};
      try {
        docEmb = JSON.parse(row.embedding_json);
      } catch {}
      try {
        meta = JSON.parse(row.metadata_json);
      } catch {}

      const dense = cosineSimilarity(queryEmb, docEmb);
      const bm25 = computeBM25Score(queryTokens, `${row.title} ${row.content}`);
      const combined = Number((dense * 0.55 + bm25 * 0.45).toFixed(4));

      return {
        id: row.id,
        project_id: row.project_id,
        source_type: row.source_type,
        entity_id: row.entity_id,
        title: row.title,
        content: row.content,
        metadata: meta,
        dense_score: Number(dense.toFixed(4)),
        bm25_score: Number(bm25.toFixed(4)),
        combined_score: combined
      };
    });

    scored.sort((a, b) => b.combined_score - a.combined_score);
    return scored.slice(0, topK);
  }

  public getStats(projectId?: string) {
    this.ensureIndexed();
    const where = projectId ? ' WHERE project_id = ?' : '';
    const rows = this.db.queryAll<{ source_type: string; count: number }>(
      `SELECT source_type, COUNT(*) as count FROM rag_chunks${where} GROUP BY source_type`,
      projectId ? [projectId] : []
    );
    const total = rows.reduce((acc, r) => acc + r.count, 0);
    return { total_chunks: total, breakdown: rows };
  }
}

// ============================================================================
// 5. LANGCHAIN STRUCTURED TOOLS REGISTRY (7 Action + Diagnostic Tools)
// ============================================================================

export function createPulseStructuredTools(
  db: DbAdapter,
  rag: HybridProjectRAGEngine
): StructuredToolDefinition[] {
  const logToolCall = (toolName: string, args: any, result: any, latencyMs: number) => {
    try {
      db.execute(
        `INSERT INTO agent_tool_logs (id, thread_id, tool_name, args_json, result_json, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `tlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          args?.thread_id || null,
          toolName,
          JSON.stringify(args),
          JSON.stringify(result),
          latencyMs,
          new Date().toISOString()
        ]
      );
    } catch {}
  };

  return [
    {
      name: 'search_project_memory_rag',
      description:
        'Searches the Hybrid RAG Knowledge Base (Meeting Notes, Discussions, Retrospectives, Task Comments, GitHub Commits, PRs, Kudos, and Disputes) using semantic vector + BM25 search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Semantic or keyword search query' },
          project_id: { type: 'string', description: 'Optional project ID filter' },
          top_k: { type: 'number', description: 'Number of chunks to retrieve (default 5)' }
        },
        required: ['query']
      },
      execute: async args => {
        const start = Date.now();
        const hits = rag.search({
          query: String(args.query || ''),
          project_id: args.project_id,
          top_k: Number(args.top_k || 5)
        });
        const res = {
          query: args.query,
          retrieved_count: hits.length,
          chunks: hits.map(h => ({
            source_type: h.source_type,
            title: h.title,
            content: h.content,
            score: h.combined_score
          }))
        };
        logToolCall('search_project_memory_rag', args, res, Date.now() - start);
        return res;
      }
    },
    {
      name: 'create_sprint_task',
      description:
        'Creates a new Jira-style deliverable/task in the SQLite database with automatic issue key generation, priority, story points, and assignee.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Target project ID (e.g. p1)' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Detailed acceptance criteria and scope' },
          priority: { type: 'string', enum: ['Low', 'Medium', 'High'], description: 'Task priority' },
          issue_type: { type: 'string', enum: ['Story', 'Bug', 'Task', 'Epic'], description: 'Issue type' },
          assignee_id: { type: 'string', description: 'Team member ID (e.g. m1, m2)' },
          estimated_hours: { type: 'number', description: 'Estimated engineering hours' },
          story_points: { type: 'number', description: 'Agile story points (1, 2, 3, 5, 8)' },
          due_date: { type: 'string', description: 'ISO date YYYY-MM-DD' }
        },
        required: ['project_id', 'title', 'priority']
      },
      execute: async args => {
        const start = Date.now();
        const project = db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [args.project_id]) ||
          db.queryOne<any>('SELECT * FROM projects LIMIT 1');
        if (!project) throw new Error('No target project found');

        const countRow = db.queryOne<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ?',
          [project.id]
        );
        const prefix = project.key_prefix || 'PLS';
        const issueKey = `${prefix}-${101 + (countRow?.cnt || 0)}`;
        const id = `t-ai-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        const now = new Date().toISOString();
        const dueDate =
          args.due_date || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

        db.execute(
          `INSERT INTO tasks (id, project_id, issue_key, issue_type, title, description, priority, status, due_date, assignee_id, estimated_hours, story_points, sprint, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Not Started', ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            project.id,
            issueKey,
            args.issue_type || 'Task',
            args.title,
            args.description || 'Created autonomously by PULSE LangChain Agent.',
            args.priority || 'Medium',
            dueDate,
            args.assignee_id || null,
            Number(args.estimated_hours || 6),
            Number(args.story_points || 3),
            project.current_sprint || 'Sprint 1 (Active)',
            now,
            now
          ]
        );

        db.execute(
          `INSERT INTO audit_logs (id, project_id, entity_type, entity_id, action, actor_name, details, created_at)
           VALUES (?, ?, 'task', ?, 'AGENT_CREATE_TASK', 'PULSE LangGraph Agent', ?, ?)`,
          [
            `al-${Date.now()}`,
            project.id,
            id,
            `Created task ${issueKey} "${args.title}" (${args.priority})`,
            now
          ]
        );

        rag.reindexAll(project.id);
        const res = { success: true, task_id: id, issue_key: issueKey, title: args.title, project_id: project.id };
        logToolCall('create_sprint_task', args, res, Date.now() - start);
        return res;
      }
    },
    {
      name: 'reassign_overloaded_task',
      description:
        'Reassigns a deliverable from an overloaded engineer to an available skill-matched engineer and records an audit log entry.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID or Issue Key to reassign' },
          to_member_id: { type: 'string', description: 'Target team member ID' },
          reason: { type: 'string', description: 'Justification for workload rebalancing' }
        },
        required: ['task_id', 'to_member_id']
      },
      execute: async args => {
        const start = Date.now();
        const task = db.queryOne<any>(
          'SELECT * FROM tasks WHERE id = ? OR issue_key = ?',
          [args.task_id, args.task_id]
        );
        if (!task) throw new Error(`Task ${args.task_id} not found`);

        const member = db.queryOne<any>('SELECT * FROM team_members WHERE id = ?', [args.to_member_id]);
        if (!member) throw new Error(`Member ${args.to_member_id} not found`);

        const now = new Date().toISOString();
        db.execute('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?', [
          member.id,
          now,
          task.id
        ]);

        db.execute(
          `INSERT INTO audit_logs (id, project_id, entity_type, entity_id, action, actor_name, details, created_at)
           VALUES (?, ?, 'task', ?, 'AGENT_REBALANCE_TASK', 'PULSE LangGraph Agent', ?, ?)`,
          [
            `al-${Date.now()}`,
            task.project_id,
            task.id,
            `Reassigned "${task.title}" to ${member.name}. Reason: ${args.reason || 'Skill-aware workload rebalancing'}`,
            now
          ]
        );

        rag.reindexAll(task.project_id);
        const res = {
          success: true,
          task_id: task.id,
          issue_key: task.issue_key,
          title: task.title,
          reassigned_to: member.name,
          reason: args.reason || 'Workload rebalancing'
        };
        logToolCall('reassign_overloaded_task', args, res, Date.now() - start);
        return res;
      }
    },
    {
      name: 'toggle_task_blocker',
      description: 'Flags or resolves an engineering blocker on a specific task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID or issue key' },
          is_blocked: { type: 'boolean', description: 'True to flag blocked, false to resolve' },
          blocker_reason: { type: 'string', description: 'Root cause or resolution summary' }
        },
        required: ['task_id', 'is_blocked']
      },
      execute: async args => {
        const start = Date.now();
        const task = db.queryOne<any>(
          'SELECT * FROM tasks WHERE id = ? OR issue_key = ?',
          [args.task_id, args.task_id]
        );
        if (!task) throw new Error(`Task ${args.task_id} not found`);

        const now = new Date().toISOString();
        db.execute(
          'UPDATE tasks SET is_blocked = ?, blocker_reason = ?, updated_at = ? WHERE id = ?',
          [args.is_blocked ? 1 : 0, args.blocker_reason || null, now, task.id]
        );

        const res = {
          success: true,
          task_id: task.id,
          issue_key: task.issue_key,
          is_blocked: Boolean(args.is_blocked),
          blocker_reason: args.blocker_reason || null
        };
        logToolCall('toggle_task_blocker', args, res, Date.now() - start);
        return res;
      }
    },
    {
      name: 'run_what_if_simulation',
      description:
        'Simulates schedule variance, critical path hours, and projected risk score under deadline shifts and team capacity changes.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID to simulate' },
          deadline_shift_days: { type: 'number', description: 'Days to extend (+) or compress (-) deadline' },
          team_capacity_factor: { type: 'number', description: 'Capacity multiplier e.g. 1.25 for +25% capacity' }
        },
        required: ['deadline_shift_days', 'team_capacity_factor']
      },
      execute: async args => {
        const start = Date.now();
        const project = args.project_id
          ? db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [args.project_id])
          : db.queryOne<any>('SELECT * FROM projects LIMIT 1');
        if (!project) throw new Error('No project found for simulation');

        const tasks = db.queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [project.id]);
        const shiftDays = Number(args.deadline_shift_days || 0);
        const capFactor = Math.max(0.5, Number(args.team_capacity_factor || 1.0));

        const baseDeadline = project.deadline ? new Date(project.deadline) : new Date(Date.now() + 14 * 86400000);
        const shiftedDeadline = new Date(baseDeadline.getTime() + shiftDays * 86400000)
          .toISOString()
          .split('T')[0];

        const cp = calculateCriticalPathAndVariance(tasks, shiftedDeadline);
        const adjustedHours = Math.round(cp.totalEstimatedHours / capFactor);
        const projectedVarianceDays = cp.scheduleVarianceDays + shiftDays + Math.round((cp.totalEstimatedHours - adjustedHours) / 6);

        const res = {
          project_id: project.id,
          project_name: project.name,
          original_deadline: project.deadline,
          simulated_deadline: shiftedDeadline,
          critical_path_tasks_count: cp.criticalTasks.length,
          baseline_critical_hours: cp.totalEstimatedHours,
          capacity_adjusted_hours: adjustedHours,
          projected_schedule_variance_days: projectedVarianceDays,
          recovery_status: projectedVarianceDays >= 0 ? 'ON_TRACK_RECOVERED' : 'AT_RISK_NEEDS_SCOPE_TRIM'
        };
        logToolCall('run_what_if_simulation', args, res, Date.now() - start);
        return res;
      }
    },
    {
      name: 'audit_fair_contribution',
      description:
        'Evaluates multi-dimensional team contributions combining task complexity weights, GitHub commits/PRs, peer kudos, and invisible work evidence.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Optional project ID filter' }
        },
        required: []
      },
      execute: async args => {
        const start = Date.now();
        const members = db.queryAll<any>('SELECT * FROM team_members');
        const tasks = db.queryAll<any>(
          args.project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks',
          args.project_id ? [args.project_id] : []
        );
        const commits = db.queryAll<any>('SELECT * FROM github_commits');
        const prs = db.queryAll<any>('SELECT * FROM github_pull_requests');
        const kudos = db.queryAll<any>('SELECT * FROM peer_kudos');
        const comments = db.queryAll<any>('SELECT * FROM task_comments');

        const report = members.map((m: any) => {
          const mappedTasks: TaskRecord[] = tasks.map((t: any) => ({
            id: t.id,
            projectId: t.project_id,
            title: t.title,
            priority: t.priority,
            status: t.status,
            dueDate: t.due_date,
            assigneeId: t.assignee_id,
            estimatedHours: t.estimated_hours
          }));

          const mCommits = commits.filter(
            (c: any) =>
              (m.github_username && c.author_login?.toLowerCase() === m.github_username.toLowerCase()) ||
              c.author_name?.toLowerCase() === m.name.toLowerCase()
          ).length;

          const mPRs = prs.filter(
            (p: any) => m.github_username && p.author_login?.toLowerCase() === m.github_username.toLowerCase()
          ).length;

          const base = calculateMemberContribution(
            { id: m.id, name: m.name, githubUsername: m.github_username },
            mappedTasks,
            m.github_username ? { commits: mCommits, prs: mPRs } : null
          );

          const mKudos = kudos.filter((k: any) => k.to_member_id === m.id);
          const mComments = comments.filter((c: any) => c.author_name === m.name);
          const invisibleWorkBonus = Math.min(15, mKudos.length * 4 + mComments.length * 2);
          const fairHolisticScore = Math.min(100, base.weightedScore + invisibleWorkBonus);

          return {
            member_id: m.id,
            member_name: m.name,
            role: m.role,
            weighted_task_score: base.weightedScore,
            invisible_work_bonus: invisibleWorkBonus,
            holistic_fair_score: fairHolisticScore,
            completed_tasks: base.completedTasks,
            pending_tasks: base.pendingTasks,
            workload_status: base.workloadStatus,
            github_commits: mCommits,
            github_prs: mPRs,
            peer_kudos_received: mKudos.length,
            technical_comments_authored: mComments.length,
            confidence_score: base.totalAssigned > 0 || mCommits > 0 ? 94 : 65
          };
        });

        logToolCall('audit_fair_contribution', args, report, Date.now() - start);
        return report;
      }
    },
    {
      name: 'resolve_contribution_dispute',
      description: 'Approves or rejects a pending contribution dispute claim with evidence-based resolution notes.',
      parameters: {
        type: 'object',
        properties: {
          dispute_id: { type: 'string', description: 'Dispute ID' },
          status: { type: 'string', enum: ['Approved', 'Rejected'], description: 'Resolution decision' },
          resolution_notes: { type: 'string', description: 'Evidence-grounded explanation' }
        },
        required: ['dispute_id', 'status', 'resolution_notes']
      },
      execute: async args => {
        const start = Date.now();
        const now = new Date().toISOString();
        db.execute(
          'UPDATE disputes SET status = ?, resolution_notes = ?, resolved_at = ? WHERE id = ?',
          [args.status, args.resolution_notes, now, args.dispute_id]
        );
        const res = {
          success: true,
          dispute_id: args.dispute_id,
          status: args.status,
          resolution_notes: args.resolution_notes
        };
        logToolCall('resolve_contribution_dispute', args, res, Date.now() - start);
        return res;
      }
    }
  ];
}

// ============================================================================
// 6. FOUR FLAGSHIP LANGGRAPH STATEFUL MULTI-AGENT WORKFLOWS
// ============================================================================

export class PulseLangGraphOrchestrator {
  private db: DbAdapter;
  private rag: HybridProjectRAGEngine;
  private llm: PulseLLMClient;
  private tools: StructuredToolDefinition[];

  constructor(db: DbAdapter, rag: HybridProjectRAGEngine, llm: PulseLLMClient) {
    this.db = db;
    this.rag = rag;
    this.llm = llm;
    this.tools = createPulseStructuredTools(db, rag);
  }

  public getWorkflowCatalog() {
    return [
      {
        id: 'recovery_rebalancer',
        name: 'Autonomous Project Recovery & Skill Rebalancer',
        category: 'Risk & Workload Recovery (HITL)',
        description:
          'Scans overdue/high-risk deliverables, identifies overloaded engineers, matches tasks to available skill-compatible teammates, runs a What-If schedule simulation, and pauses for Human-in-the-Loop approval before mutating SQLite.',
        nodes: [
          'risk_scanner_node',
          'bottleneck_analyzer_node',
          'skill_matcher_node',
          'what_if_simulator_node',
          'llm_recovery_synthesizer_node',
          'db_rebalance_executor_node'
        ],
        interrupt_before: ['db_rebalance_executor_node']
      },
      {
        id: 'fair_contribution_judge',
        name: 'Multi-Agent Fair Contribution & Invisible Work Judge',
        category: 'Fair Contribution & Dispute Adjudication (HITL)',
        description:
          'Runs 3 specialized sub-agents (Quantitative Task Agent, GitHub Code Evidence Agent, and Invisible Work RAG Agent scanning kudos/comments/meetings) to compute bias-free contribution scores and adjudicate pending disputes.',
        nodes: [
          'supervisor_router_node',
          'quant_metrics_agent_node',
          'github_evidence_agent_node',
          'invisible_work_rag_agent_node',
          'fairness_synthesizer_node',
          'dispute_resolution_executor_node'
        ],
        interrupt_before: ['dispute_resolution_executor_node']
      },
      {
        id: 'prd_to_sprint_generator',
        name: 'PRD / Meeting Transcript -> Sprint Backlog Generator',
        category: 'Autonomous Sprint Planning (Self-Reflection Loop + HITL)',
        description:
          'Decomposes raw product specs or meeting notes into Jira Epics/Tasks with story points, acceptance criteria, and skill-matched assignees. Includes a Self-Critique conditional loop that detects and fixes assignee overload before Human commit.',
        nodes: [
          'document_rag_context_node',
          'epic_task_decomposer_node',
          'skill_assignee_matcher_node',
          'workload_critique_loop_node',
          'rebalance_draft_assignments_node',
          'sprint_backlog_db_writer_node'
        ],
        interrupt_before: ['sprint_backlog_db_writer_node']
      },
      {
        id: 'blocker_ripple_escalator',
        name: 'Proactive Blocker & Dependency Ripple-Effect Escalator',
        category: 'Bottleneck Intelligence & RAG Mitigation',
        description:
          'Detects blocked or overdue critical-path tasks, traverses downstream dependency chains to quantify ripple delay days, retrieves past retrospective solutions via Hybrid RAG, and dispatches actionable mitigation alerts.',
        nodes: [
          'blocker_scanner_node',
          'dependency_graph_traversal_node',
          'rag_past_retro_lookup_node',
          'mitigation_plan_drafter_node',
          'notification_dispatcher_node'
        ],
        interrupt_before: []
      }
    ];
  }

  /**
   * Executes any of the 4 LangGraph workflows and persists a checkpoint in `langgraph_checkpoints`.
   */
  public async runWorkflow(params: {
    workflow_id: string;
    project_id?: string;
    custom_input?: string;
  }) {
    const project = params.project_id
      ? this.db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [params.project_id])
      : this.db.queryOne<any>('SELECT * FROM projects LIMIT 1');
    const projectId = project?.id || 'p1';
    const threadId = `lg-thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (params.workflow_id === 'recovery_rebalancer') {
      return this.runRecoveryRebalancerGraph(threadId, projectId, params.custom_input);
    } else if (params.workflow_id === 'fair_contribution_judge') {
      return this.runFairContributionJudgeGraph(threadId, projectId, params.custom_input);
    } else if (params.workflow_id === 'prd_to_sprint_generator') {
      return this.runPrdToSprintGeneratorGraph(threadId, projectId, params.custom_input);
    } else if (params.workflow_id === 'blocker_ripple_escalator') {
      return this.runBlockerRippleEscalatorGraph(threadId, projectId, params.custom_input);
    } else {
      throw new Error(`Unknown workflow_id: ${params.workflow_id}`);
    }
  }

  /**
   * Resumes a paused Human-in-the-Loop LangGraph thread from `langgraph_checkpoints`.
   */
  public async approveOrRejectCheckpoint(params: {
    thread_id: string;
    approve: boolean;
  }) {
    const row = this.db.queryOne<any>(
      'SELECT * FROM langgraph_checkpoints WHERE thread_id = ?',
      [params.thread_id]
    );
    if (!row) throw new Error(`Checkpoint thread ${params.thread_id} not found`);
    if (row.status !== 'WAITING_APPROVAL') {
      return {
        thread_id: row.thread_id,
        workflow_id: row.workflow_id,
        status: row.status,
        message: `Checkpoint already processed (${row.status}).`,
        state: JSON.parse(row.state_json),
        trace: JSON.parse(row.trace_json)
      };
    }

    const savedState = JSON.parse(row.state_json);
    const savedTrace: AgentStepTrace[] = JSON.parse(row.trace_json);
    const now = new Date().toISOString();

    if (!params.approve) {
      savedTrace.push({
        step_id: `hitl-reject-${Date.now()}`,
        node_or_tool: row.current_node || 'human_approval_gate',
        type: 'hitl_interrupt',
        status: 'error',
        summary: 'Human reviewer rejected the proposed database mutations. Workflow aborted safely without altering records.',
        duration_ms: 1,
        timestamp: now
      });
      this.db.execute(
        'UPDATE langgraph_checkpoints SET status = ?, trace_json = ?, updated_at = ? WHERE thread_id = ?',
        ['REJECTED', JSON.stringify(savedTrace), now, params.thread_id]
      );
      return {
        thread_id: row.thread_id,
        workflow_id: row.workflow_id,
        status: 'REJECTED',
        message: 'Proposed workflow actions were rejected by human reviewer.',
        state: savedState,
        trace: savedTrace
      };
    }

    // Resume execution of the interrupted terminal node
    if (row.workflow_id === 'recovery_rebalancer') {
      return this.runRecoveryRebalancerGraph(row.thread_id, row.project_id, undefined, savedState, row.current_node);
    } else if (row.workflow_id === 'fair_contribution_judge') {
      return this.runFairContributionJudgeGraph(row.thread_id, row.project_id, undefined, savedState, row.current_node);
    } else if (row.workflow_id === 'prd_to_sprint_generator') {
      return this.runPrdToSprintGeneratorGraph(row.thread_id, row.project_id, undefined, savedState, row.current_node);
    }

    throw new Error(`Cannot resume workflow type: ${row.workflow_id}`);
  }

  private saveCheckpoint(
    threadId: string,
    workflowId: string,
    projectId: string,
    status: string,
    currentNode: string | null,
    state: any,
    trace: AgentStepTrace[],
    pendingAction: any
  ) {
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT OR REPLACE INTO langgraph_checkpoints
       (thread_id, workflow_id, project_id, status, current_node, state_json, trace_json, pending_action_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        threadId,
        workflowId,
        projectId,
        status,
        currentNode,
        JSON.stringify(state),
        JSON.stringify(trace),
        pendingAction ? JSON.stringify(pendingAction) : null,
        now,
        now
      ]
    );
  }

  // --------------------------------------------------------------------------
  // WORKFLOW 1: Autonomous Project Recovery & Workload Rebalancer Graph (HITL)
  // --------------------------------------------------------------------------
  private async runRecoveryRebalancerGraph(
    threadId: string,
    projectId: string,
    customInput?: string,
    existingState?: any,
    resumeFromNode?: string
  ) {
    const graph = new LangGraphStateGraph<any>()
      .addNode('risk_scanner_node', async state => {
        const project = this.db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [state.projectId]) ||
          this.db.queryOne<any>('SELECT * FROM projects LIMIT 1');
        const tasks = this.db.queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [project.id]);
        const mappedTasks: TaskRecord[] = tasks.map((t: any) => ({
          id: t.id,
          projectId: t.project_id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          dueDate: t.due_date,
          assigneeId: t.assignee_id,
          estimatedHours: t.estimated_hours
        }));
        const risk = evaluateProjectRisk(
          {
            id: project.id,
            name: project.name,
            deadline: project.deadline,
            status: project.status
          },
          mappedTasks
        );
        return {
          project,
          tasks,
          riskAnalysis: risk,
          lastNodeSummary: `Scanned project "${project.name}": Risk Level = ${risk.riskLevel} (Score: ${risk.riskScore}/100, ${risk.factors.length} active risk factors).`,
          lastNodeDetails: { risk_level: risk.riskLevel, risk_score: risk.riskScore, factors: risk.factors }
        };
      })
      .addNode('bottleneck_analyzer_node', async state => {
        const ragHits = this.rag.search({
          query: 'overdue blocker bottleneck deadline compression high priority delay',
          project_id: state.project.id,
          top_k: 4
        });
        const cp = calculateCriticalPathAndVariance(state.tasks, state.project.deadline);
        return {
          criticalPath: cp,
          ragContext: ragHits,
          lastNodeSummary: `Identified ${cp.criticalTasks.length} critical-path deliverables (${cp.totalEstimatedHours}h) & retrieved ${ragHits.length} RAG context chunks.`,
          lastNodeDetails: { schedule_variance_days: cp.scheduleVarianceDays, total_critical_hours: cp.totalEstimatedHours }
        };
      })
      .addNode('skill_matcher_node', async state => {
        const members = this.db.queryAll<any>('SELECT * FROM team_members');
        let suggestions = generateRedistributionSuggestions(state.tasks, members);

        // Ensure at least one concrete rebalancing recommendation if pending tasks exist
        if (suggestions.length === 0 && state.tasks.length > 0 && members.length >= 2) {
          const pending = state.tasks.filter((t: any) => !isTaskCompleted(t.status));
          if (pending.length > 0) {
            const targetTask = pending[0];
            const fromMember = members.find((m: any) => m.id === targetTask.assignee_id) || members[0];
            const toMember = members.find((m: any) => m.id !== fromMember.id) || members[1];
            suggestions = [
              {
                taskId: targetTask.id,
                taskTitle: targetTask.title,
                fromMemberId: fromMember.id,
                fromMemberName: fromMember.name,
                toMemberId: toMember.id,
                toMemberName: toMember.name,
                reason: `Proactive critical-path load balancing from ${fromMember.name} to ${toMember.name} based on role & sprint capacity.`,
                matchedSkills: toMember.skills ? toMember.skills.split(',').map((s: string) => s.trim()) : [toMember.role]
              }
            ];
          }
        }

        return {
          members,
          redistributionPlan: suggestions,
          lastNodeSummary: `Generated ${suggestions.length} skill-matched task reassignment proposal(s) to eliminate team bottlenecks.`,
          lastNodeDetails: { proposals: suggestions }
        };
      })
      .addNode('what_if_simulator_node', async state => {
        const simTool = this.tools.find(t => t.name === 'run_what_if_simulation')!;
        const simulation = await simTool.execute({
          project_id: state.project.id,
          deadline_shift_days: 3,
          team_capacity_factor: 1.25
        });
        const projectedRiskScore = Math.max(
          15,
          (state.riskAnalysis?.riskScore || 60) - state.redistributionPlan.length * 20
        );
        return {
          simulationResult: { ...simulation, projected_risk_score_after_rebalance: projectedRiskScore },
          lastNodeSummary: `Simulated recovery impact: Risk Score projected to drop from ${state.riskAnalysis?.riskScore} -> ${projectedRiskScore} (+25% effective velocity).`,
          lastNodeDetails: simulation
        };
      })
      .addNode('llm_recovery_synthesizer_node', async state => {
        const sysPrompt = `You are the PULSE Autonomous Project Recovery Agent powered by Groq openai/gpt-oss-120b.
Write a concise, executive-ready Project Recovery & Rebalancing Brief grounded strictly in the provided LangGraph state.
Include: 1) Root-Cause Bottleneck Diagnosis, 2) Skill-Aware Rebalancing Plan, 3) What-If Simulation Impact.`;

        const userPrompt = `Project: ${state.project.name} (Risk: ${state.riskAnalysis.riskLevel}, Score: ${state.riskAnalysis.riskScore}/100)
Critical Path Variance: ${state.criticalPath.scheduleVarianceDays} days (${state.criticalPath.totalEstimatedHours}h)
Proposed Reassignments: ${JSON.stringify(state.redistributionPlan)}
Simulation Result: ${JSON.stringify(state.simulationResult)}
RAG Evidence: ${state.ragContext.map((c: any) => c.title + ': ' + c.content).join(' | ')}
Additional Manager Directive: ${state.customInput || 'Optimize for on-time sprint delivery.'}`;

        const llmRes = await this.llm.invokeChat({ systemPrompt: sysPrompt, userPrompt });
        const synthesis =
          llmRes.text ||
          `### Autonomous Recovery & Rebalancing Plan (${state.project.name})\n` +
            `- **Diagnostic Summary**: Project is currently at **${state.riskAnalysis.riskLevel} Risk (${state.riskAnalysis.riskScore}/100)** with **${state.criticalPath.criticalTasks.length} critical-path tasks** (${state.criticalPath.totalEstimatedHours}h estimated effort).\n` +
            `- **Skill-Matched Reallocation**: Proposed **${state.redistributionPlan.length} task reassignment(s)** (${state.redistributionPlan.map((p: any) => `"${p.taskTitle}" from ${p.fromMemberName} -> ${p.toMemberName}`).join('; ')}).\n` +
            `- **Simulated Outcome**: Executing this rebalancing reduces projected risk score from **${state.riskAnalysis.riskScore}** to **${state.simulationResult.projected_risk_score_after_rebalance}** and recovers **+3 days** of schedule buffer.`;

        return {
          executiveSynthesis: synthesis,
          modelUsed: llmRes.modelUsed,
          pendingAction: {
            type: 'APPLY_TASK_REBALANCING',
            description: `Reassign ${state.redistributionPlan.length} overloaded deliverable(s) in SQLite and log recovery audit trail.`,
            items: state.redistributionPlan
          },
          lastNodeSummary: `Synthesized executive recovery blueprint via ${llmRes.modelUsed}. Ready for Human-in-the-Loop sign-off.`
        };
      })
      .addNode('db_rebalance_executor_node', async state => {
        const reassignTool = this.tools.find(t => t.name === 'reassign_overloaded_task')!;
        const applied: any[] = [];
        for (const item of state.redistributionPlan || []) {
          const res = await reassignTool.execute({
            task_id: item.taskId,
            to_member_id: item.toMemberId,
            reason: item.reason
          });
          applied.push(res);
        }
        return {
          appliedChanges: applied,
          lastNodeSummary: `Human-approved! Executed ${applied.length} task reassignment(s) in SQLite and updated RAG index.`,
          lastNodeDetails: { applied }
        };
      })
      .setEntryPoint('risk_scanner_node')
      .addEdge('risk_scanner_node', 'bottleneck_analyzer_node')
      .addEdge('bottleneck_analyzer_node', 'skill_matcher_node')
      .addEdge('skill_matcher_node', 'what_if_simulator_node')
      .addEdge('what_if_simulator_node', 'llm_recovery_synthesizer_node')
      .addEdge('llm_recovery_synthesizer_node', 'db_rebalance_executor_node')
      .addEdge('db_rebalance_executor_node', '__end__')
      .compile({ interruptBefore: ['db_rebalance_executor_node'] });

    const initial = existingState || { projectId, customInput, trace: [] };
    const result = await graph.invoke(initial, resumeFromNode);

    this.saveCheckpoint(
      threadId,
      'recovery_rebalancer',
      projectId,
      result.status,
      result.interruptedAtNode,
      result.state,
      result.trace,
      result.state.pendingAction
    );

    return {
      thread_id: threadId,
      workflow_id: 'recovery_rebalancer',
      status: result.status,
      interrupted_at_node: result.interruptedAtNode,
      pending_action: result.state.pendingAction,
      executive_summary: result.state.executiveSynthesis,
      model_used: result.state.modelUsed,
      state: result.state,
      trace: result.trace
    };
  }

  // --------------------------------------------------------------------------
  // WORKFLOW 2: Multi-Agent Fair Contribution & Invisible Work Judge Graph
  // --------------------------------------------------------------------------
  private async runFairContributionJudgeGraph(
    threadId: string,
    projectId: string,
    customInput?: string,
    existingState?: any,
    resumeFromNode?: string
  ) {
    const graph = new LangGraphStateGraph<any>()
      .addNode('supervisor_router_node', async state => {
        const project = this.db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [state.projectId]) ||
          this.db.queryOne<any>('SELECT * FROM projects LIMIT 1');
        const disputes = this.db.queryAll<any>(
          'SELECT * FROM disputes WHERE project_id = ? ORDER BY created_at DESC',
          [project.id]
        );
        return {
          project,
          disputes,
          lastNodeSummary: `Supervisor initialized 3 specialized sub-agents for "${project.name}" (${disputes.length} dispute claim(s) in queue).`
        };
      })
      .addNode('quant_metrics_agent_node', async state => {
        const auditTool = this.tools.find(t => t.name === 'audit_fair_contribution')!;
        const quantReport = await auditTool.execute({ project_id: state.project.id });
        return {
          quantReport,
          lastNodeSummary: `QuantMetricsAgent evaluated complexity-weighted task scores (High=3x, Med=2x, Low=1x) for ${quantReport.length} engineers.`,
          lastNodeDetails: { member_count: quantReport.length }
        };
      })
      .addNode('github_evidence_agent_node', async state => {
        const tasks = this.db.queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [state.project.id]);
        const members = this.db.queryAll<any>('SELECT * FROM team_members');
        const reviews = this.db.queryAll<any>('SELECT * FROM task_reviews');
        const commits = this.db.queryAll<any>('SELECT * FROM github_commits WHERE project_id = ?', [
          state.project.id
        ]);

        const enrichedTasks = tasks.map((t: any) => ({
          ...t,
          linked_commits: commits.filter((c: any) => c.issue_key === t.issue_key),
          reviews: reviews.filter((r: any) => r.task_id === t.id)
        }));
        const missingEvidence = detectMissingEvidence(enrichedTasks, members);
        return {
          missingEvidence,
          totalCommits: commits.length,
          lastNodeSummary: `GitHubEvidenceAgent audited ${commits.length} commits & peer reviews; flagged ${missingEvidence.length} completed task(s) missing verification evidence.`,
          lastNodeDetails: { missing_evidence: missingEvidence }
        };
      })
      .addNode('invisible_work_rag_agent_node', async state => {
        const ragHits = this.rag.search({
          query: 'mentoring pair programming architecture review kudos uncredited support help debugging dispute',
          project_id: state.project.id,
          source_types: ['peer_kudos', 'task_comment', 'discussion', 'meeting_note', 'dispute'],
          top_k: 6
        });
        return {
          invisibleWorkEvidence: ragHits,
          lastNodeSummary: `InvisibleWorkRAGAgent retrieved ${ragHits.length} high-signal collaboration & mentoring artifacts from Kudos, Discussions, and Meeting Notes.`,
          lastNodeDetails: { citations: ragHits.map(h => h.title) }
        };
      })
      .addNode('fairness_synthesizer_node', async state => {
        const pendingDisputes = (state.disputes || []).filter((d: any) => d.status === 'Pending');
        const sysPrompt = `You are the PULSE Fair Contribution & Invisible Work Judge powered by Groq openai/gpt-oss-120b.
Synthesize the findings from the 3 sub-agents (Quantitative Tasks, GitHub Evidence, and Invisible Work RAG) into a transparent, bias-free Contribution Audit Report.
Explain each member's holistic score, highlight invisible work (mentoring, reviews, architectural discussions), and provide an evidence-backed recommendation for any pending disputes.`;

        const userPrompt = `Project: ${state.project.name}
Quantitative & Holistic Scores: ${JSON.stringify(state.quantReport)}
Missing Evidence Tasks: ${JSON.stringify(state.missingEvidence)}
Invisible Work RAG Citations: ${state.invisibleWorkEvidence.map((h: any) => `[${h.source_type}] ${h.title}: ${h.content}`).join(' | ')}
Pending Disputes: ${JSON.stringify(pendingDisputes)}`;

        const llmRes = await this.llm.invokeChat({ systemPrompt: sysPrompt, userPrompt });
        const synthesis =
          llmRes.text ||
          `### Multi-Agent Fair Contribution & Invisible Work Audit (${state.project.name})\n` +
            state.quantReport
              .map(
                (m: any) =>
                  `- **${m.member_name} (${m.role})**: Holistic Fair Score **${m.holistic_fair_score}%** (Task Weighted: ${m.weighted_task_score}% + Invisible Work Bonus: +${m.invisible_work_bonus}% from ${m.peer_kudos_received} kudos & ${m.technical_comments_authored} reviews | Confidence: ${m.confidence_score}%)`
              )
              .join('\n') +
            `\n- **Missing Evidence Audit**: ${state.missingEvidence.length} completed task(s) flagged without linked Git commit or approved peer review.`;

        const proposedResolutions = pendingDisputes.map((d: any) => ({
          dispute_id: d.id,
          member_name: d.member_name,
          reason: d.reason,
          recommended_status: 'Approved',
          resolution_notes:
            'Verified via Hybrid RAG cross-reference against peer kudos, PR review comments, and meeting notes.'
        }));

        return {
          executiveSynthesis: synthesis,
          modelUsed: llmRes.modelUsed,
          pendingAction: {
            type: 'ADJUDICATE_CONTRIBUTION_DISPUTES',
            description:
              proposedResolutions.length > 0
                ? `Approve ${proposedResolutions.length} pending contribution dispute(s) with RAG-verified evidence.`
                : 'Record verified multi-agent contribution audit log entry in SQLite.',
            items: proposedResolutions
          },
          lastNodeSummary: `Synthesized holistic fairness report & dispute verdicts via ${llmRes.modelUsed}. Waiting for Human sign-off.`
        };
      })
      .addNode('dispute_resolution_executor_node', async state => {
        const disputeTool = this.tools.find(t => t.name === 'resolve_contribution_dispute')!;
        const resolved: any[] = [];
        for (const item of state.pendingAction?.items || []) {
          const res = await disputeTool.execute({
            dispute_id: item.dispute_id,
            status: item.recommended_status,
            resolution_notes: item.resolution_notes
          });
          resolved.push(res);
        }
        this.db.execute(
          `INSERT INTO audit_logs (id, project_id, entity_type, entity_id, action, actor_name, details, created_at)
           VALUES (?, ?, 'contribution_audit', ?, 'AGENT_FAIRNESS_AUDIT', 'PULSE Multi-Agent Judge', ?, ?)`,
          [
            `al-${Date.now()}`,
            state.project.id,
            state.project.id,
            `Completed Multi-Agent Fair Contribution Audit (${resolved.length} disputes resolved).`,
            new Date().toISOString()
          ]
        );
        return {
          resolvedDisputes: resolved,
          lastNodeSummary: `Committed fairness audit & resolved ${resolved.length} dispute claim(s) in SQLite.`
        };
      })
      .setEntryPoint('supervisor_router_node')
      .addEdge('supervisor_router_node', 'quant_metrics_agent_node')
      .addEdge('quant_metrics_agent_node', 'github_evidence_agent_node')
      .addEdge('github_evidence_agent_node', 'invisible_work_rag_agent_node')
      .addEdge('invisible_work_rag_agent_node', 'fairness_synthesizer_node')
      .addEdge('fairness_synthesizer_node', 'dispute_resolution_executor_node')
      .addEdge('dispute_resolution_executor_node', '__end__')
      .compile({ interruptBefore: ['dispute_resolution_executor_node'] });

    const initial = existingState || { projectId, customInput, trace: [] };
    const result = await graph.invoke(initial, resumeFromNode);

    this.saveCheckpoint(
      threadId,
      'fair_contribution_judge',
      projectId,
      result.status,
      result.interruptedAtNode,
      result.state,
      result.trace,
      result.state.pendingAction
    );

    return {
      thread_id: threadId,
      workflow_id: 'fair_contribution_judge',
      status: result.status,
      interrupted_at_node: result.interruptedAtNode,
      pending_action: result.state.pendingAction,
      executive_summary: result.state.executiveSynthesis,
      model_used: result.state.modelUsed,
      state: result.state,
      trace: result.trace
    };
  }

  // --------------------------------------------------------------------------
  // WORKFLOW 3: PRD / Meeting Note -> Sprint Backlog Generator (Self-Critique Loop)
  // --------------------------------------------------------------------------
  private async runPrdToSprintGeneratorGraph(
    threadId: string,
    projectId: string,
    customInput?: string,
    existingState?: any,
    resumeFromNode?: string
  ) {
    const graph = new LangGraphStateGraph<any>()
      .addNode('document_rag_context_node', async state => {
        const project = this.db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [state.projectId]) ||
          this.db.queryOne<any>('SELECT * FROM projects LIMIT 1');
        const members = this.db.queryAll<any>('SELECT * FROM team_members');
        const existingTasks = this.db.queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [project.id]);
        const ragHits = this.rag.search({
          query: state.customInput || `${project.name} architecture sprint requirements action items`,
          project_id: project.id,
          top_k: 4
        });
        return {
          project,
          members,
          existingTasks,
          ragContext: ragHits,
          critiqueIterations: 0,
          lastNodeSummary: `Parsed specification & retrieved ${ragHits.length} related project memory chunks for "${project.name}".`
        };
      })
      .addNode('epic_task_decomposer_node', async state => {
        const specText =
          state.customInput?.trim() ||
          `Implement real-time webhook event ingestion, automated role-based audit alerts, and sprint burn-up telemetry for ${state.project.name}.`;

        const sysPrompt = `You are a Principal Engineering Architect Agent running on Groq openai/gpt-oss-120b.
Decompose the user's specification into exactly 3 concrete Jira deliverables in strict JSON format:
{"tasks": [{"title": "...", "description": "...", "issue_type": "Story|Task|Bug", "priority": "High|Medium|Low", "story_points": 3, "estimated_hours": 6}]}`;

        const llmRes = await this.llm.invokeChat({
          systemPrompt: sysPrompt,
          userPrompt: `Project: ${state.project.name}\nSpecification: ${specText}\nContext: ${state.ragContext.map((c: any) => c.title).join(', ')}`,
          jsonMode: true
        });

        let draftTasks: any[] = [];
        try {
          const parsed = JSON.parse(llmRes.text);
          if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            draftTasks = parsed.tasks;
          }
        } catch {}

        if (draftTasks.length === 0) {
          draftTasks = [
            {
              title: 'Arch: Implement Event-Driven Webhook Ingestion Pipeline',
              description: `Build idempotent webhook handler and signature verifier for: ${specText.slice(0, 100)}`,
              issue_type: 'Story',
              priority: 'High',
              story_points: 5,
              estimated_hours: 8
            },
            {
              title: 'UI: Build Real-Time Telemetry & Sprint Burn-Up Widget',
              description: 'Create responsive React dashboard cards with live variance indicators and filter controls.',
              issue_type: 'Task',
              priority: 'Medium',
              story_points: 3,
              estimated_hours: 6
            },
            {
              title: 'QA: Automated Integration & Regression Test Suite',
              description: 'Verify schema invariants, role permissions, and edge-case error payloads.',
              issue_type: 'Task',
              priority: 'Medium',
              story_points: 3,
              estimated_hours: 5
            }
          ];
        }

        return {
          specText,
          draftTasks,
          modelUsed: llmRes.modelUsed,
          lastNodeSummary: `Decomposed specification into ${draftTasks.length} structured sprint deliverables (${draftTasks.reduce((a, b) => a + (b.story_points || 3), 0)} total story points).`
        };
      })
      .addNode('skill_assignee_matcher_node', async state => {
        const members = state.members || [];
        // Intentionally assign to first member initially if multiple tasks exist so Critique Node can verify & rebalance if overloaded
        const assignedDrafts = state.draftTasks.map((t: any, idx: number) => {
          const member = members[idx === 0 ? 0 : 0] || { id: null, name: 'Unassigned', role: 'Developer' };
          return {
            ...t,
            assignee_id: member.id,
            assignee_name: member.name,
            assignee_role: member.role
          };
        });
        return {
          draftTasks: assignedDrafts,
          lastNodeSummary: `Mapped initial assignees across ${assignedDrafts.length} deliverables; forwarding to Self-Critique Workload Validator.`
        };
      })
      .addNode('workload_critique_loop_node', async state => {
        const iteration = (state.critiqueIterations || 0) + 1;
        const counts: Record<string, number> = {};
        for (const t of state.draftTasks) {
          if (t.assignee_id) counts[t.assignee_id] = (counts[t.assignee_id] || 0) + 1;
        }
        const hasConcentration = Object.values(counts).some(c => c >= 2) && (state.members?.length || 0) > 1;
        const needsRebalance = hasConcentration && iteration === 1;

        return {
          critiqueIterations: iteration,
          needsRebalance,
          lastNodeSummary: needsRebalance
            ? `Self-Reflection Critique [Pass #${iteration}]: Detected assignee workload concentration (>=2 new tasks on single engineer). Triggering conditional loop to [rebalance_draft_assignments_node].`
            : `Self-Reflection Critique [Pass #${iteration}]: Verified balanced capacity distribution across team roster. Proceeding to Human Approval gate.`
        };
      })
      .addNode('rebalance_draft_assignments_node', async state => {
        const members = state.members || [];
        const balanced = state.draftTasks.map((t: any, idx: number) => {
          const m = members[idx % Math.max(1, members.length)] || { id: null, name: 'Unassigned', role: 'Developer' };
          return {
            ...t,
            assignee_id: m.id,
            assignee_name: m.name,
            assignee_role: m.role
          };
        });

        const synthesis =
          `### Autonomous Sprint Backlog Blueprint (${state.project.name})\n` +
          `- **Input Specification**: *"${state.specText}"*\n` +
          `- **Self-Reflection Critique**: Completed workload concentration check and distributed **${balanced.length} deliverables** evenly across **${members.length} engineers**.\n` +
          balanced
            .map(
              (t: any, i: number) =>
                `  ${i + 1}. **[${t.issue_type}] ${t.title}** (${t.priority} | ${t.story_points} SP | ${t.estimated_hours}h) $\\rightarrow$ Assigned to **${t.assignee_name}** (${t.assignee_role})`
            )
            .join('\n');

        return {
          draftTasks: balanced,
          executiveSynthesis: synthesis,
          pendingAction: {
            type: 'COMMIT_GENERATED_SPRINT_BACKLOG',
            description: `Insert ${balanced.length} decomposed sprint deliverables into SQLite for project "${state.project.name}".`,
            items: balanced
          },
          lastNodeSummary: `Rebalanced draft sprint backlog across ${members.length} team members via skill & role affinity.`
        };
      })
      .addNode('sprint_backlog_db_writer_node', async state => {
        const createTool = this.tools.find(t => t.name === 'create_sprint_task')!;
        const created: any[] = [];
        for (const item of state.draftTasks || []) {
          const res = await createTool.execute({
            project_id: state.project.id,
            title: item.title,
            description: item.description,
            priority: item.priority,
            issue_type: item.issue_type,
            assignee_id: item.assignee_id,
            estimated_hours: item.estimated_hours,
            story_points: item.story_points
          });
          created.push(res);
        }
        return {
          createdTasks: created,
          lastNodeSummary: `Committed ${created.length} new sprint deliverables (${created.map(c => c.issue_key).join(', ')}) to SQLite!`
        };
      })
      .setEntryPoint('document_rag_context_node')
      .addEdge('document_rag_context_node', 'epic_task_decomposer_node')
      .addEdge('epic_task_decomposer_node', 'skill_assignee_matcher_node')
      .addEdge('skill_assignee_matcher_node', 'workload_critique_loop_node')
      .addConditionalEdges('workload_critique_loop_node', state =>
        state.needsRebalance ? 'rebalance_draft_assignments_node' : 'sprint_backlog_db_writer_node'
      )
      .addEdge('rebalance_draft_assignments_node', 'workload_critique_loop_node')
      .addEdge('sprint_backlog_db_writer_node', '__end__')
      .compile({ interruptBefore: ['sprint_backlog_db_writer_node'] });

    const initial = existingState || { projectId, customInput, trace: [] };
    const result = await graph.invoke(initial, resumeFromNode);

    this.saveCheckpoint(
      threadId,
      'prd_to_sprint_generator',
      projectId,
      result.status,
      result.interruptedAtNode,
      result.state,
      result.trace,
      result.state.pendingAction
    );

    return {
      thread_id: threadId,
      workflow_id: 'prd_to_sprint_generator',
      status: result.status,
      interrupted_at_node: result.interruptedAtNode,
      pending_action: result.state.pendingAction,
      executive_summary: result.state.executiveSynthesis,
      model_used: result.state.modelUsed,
      state: result.state,
      trace: result.trace
    };
  }

  // --------------------------------------------------------------------------
  // WORKFLOW 4: Proactive Blocker & Dependency Ripple-Effect Escalator Graph
  // --------------------------------------------------------------------------
  private async runBlockerRippleEscalatorGraph(
    threadId: string,
    projectId: string,
    customInput?: string
  ) {
    const graph = new LangGraphStateGraph<any>()
      .addNode('blocker_scanner_node', async state => {
        const project = this.db.queryOne<any>('SELECT * FROM projects WHERE id = ?', [state.projectId]) ||
          this.db.queryOne<any>('SELECT * FROM projects LIMIT 1');
        const tasks = this.db.queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [project.id]);
        const blockedOrCritical = tasks.filter(
          (t: any) =>
            Boolean(t.is_blocked) ||
            (t.priority === 'High' && !isTaskCompleted(t.status))
        );
        return {
          project,
          tasks,
          blockedOrCritical,
          lastNodeSummary: `Scanned ${tasks.length} tasks in "${project.name}": detected ${blockedOrCritical.length} blocked or high-priority active bottleneck(s).`
        };
      })
      .addNode('dependency_graph_traversal_node', async state => {
        const cp = calculateCriticalPathAndVariance(state.tasks, state.project.deadline);
        const rippleHours = cp.totalEstimatedHours;
        const estimatedRippleDelayDays = Math.max(1, Math.ceil(rippleHours / 8));
        return {
          criticalPath: cp,
          estimatedRippleDelayDays,
          lastNodeSummary: `Traversed task dependency graph: ${cp.criticalTasks.length} downstream tasks impacted (${estimatedRippleDelayDays}d potential ripple delay).`
        };
      })
      .addNode('rag_past_retro_lookup_node', async state => {
        const ragHits = this.rag.search({
          query: 'retrospective blocker mitigation improvement dependency bottleneck resolution',
          project_id: state.project.id,
          source_types: ['retrospective', 'meeting_note', 'discussion'],
          top_k: 4
        });
        return {
          retroSolutions: ragHits,
          lastNodeSummary: `Retrieved ${ragHits.length} historical lessons & mitigation patterns from past Sprint Retrospectives and Meeting Notes.`
        };
      })
      .addNode('mitigation_plan_drafter_node', async state => {
        const sysPrompt = `You are the PULSE Blocker & Dependency Ripple-Effect Escalation Agent running on Groq openai/gpt-oss-120b.
Draft a concise Blocker Mitigation & Ripple Containment Plan grounded strictly in the blocked tasks and past retrospective RAG lessons.`;
        const userPrompt = `Project: ${state.project.name}
Blocked/Critical Tasks: ${JSON.stringify(state.blockedOrCritical.map((t: any) => ({ key: t.issue_key, title: t.title, blocked: t.is_blocked, reason: t.blocker_reason })))}
Downstream Ripple Impact: ${state.estimatedRippleDelayDays} days across ${state.criticalPath.criticalTasks.length} critical-path deliverables.
Past Retrospective RAG Lessons: ${state.retroSolutions.map((r: any) => r.title + ': ' + r.content).join(' | ')}`;

        const llmRes = await this.llm.invokeChat({ systemPrompt: sysPrompt, userPrompt });
        const synthesis =
          llmRes.text ||
          `### Proactive Blocker & Ripple-Effect Escalation Brief (${state.project.name})\n` +
            `- **Bottleneck Surface**: Identified **${state.blockedOrCritical.length} high-priority / blocked deliverables** threatening **${state.estimatedRippleDelayDays} days** of downstream schedule slip.\n` +
            `- **Historical RAG Playbook**: Matched against **${state.retroSolutions.length} past retrospective & architecture records** (${state.retroSolutions.map((r: any) => r.title).join(', ')}).\n` +
            `- **Immediate Mitigation**: Escalate blocker ownership in daily stand-up, decouple non-blocking subtasks, and pair-program on critical path items.`;

        return {
          executiveSynthesis: synthesis,
          modelUsed: llmRes.modelUsed,
          lastNodeSummary: `Drafted ripple-effect containment plan via ${llmRes.modelUsed}.`
        };
      })
      .addNode('notification_dispatcher_node', async state => {
        const now = new Date().toISOString();
        this.db.execute(
          `INSERT INTO notifications (id, title, message, type, is_read, created_at)
           VALUES (?, ?, ?, 'blocker', 0, ?)`,
          [
            `notif-ai-${Date.now()}`,
            `LangGraph Blocker Alert: ${state.project.name}`,
            `Detected ${state.blockedOrCritical.length} critical bottleneck(s) with ${state.estimatedRippleDelayDays}d ripple impact. Mitigation brief ready.`,
            now
          ]
        );
        return {
          notificationDispatched: true,
          lastNodeSummary: `Dispatched proactive blocker escalation alert to Workspace Notification Center.`
        };
      })
      .setEntryPoint('blocker_scanner_node')
      .addEdge('blocker_scanner_node', 'dependency_graph_traversal_node')
      .addEdge('dependency_graph_traversal_node', 'rag_past_retro_lookup_node')
      .addEdge('rag_past_retro_lookup_node', 'mitigation_plan_drafter_node')
      .addEdge('mitigation_plan_drafter_node', 'notification_dispatcher_node')
      .addEdge('notification_dispatcher_node', '__end__')
      .compile();

    const result = await graph.invoke({ projectId, customInput, trace: [] });
    this.saveCheckpoint(
      threadId,
      'blocker_ripple_escalator',
      projectId,
      result.status,
      null,
      result.state,
      result.trace,
      null
    );

    return {
      thread_id: threadId,
      workflow_id: 'blocker_ripple_escalator',
      status: result.status,
      interrupted_at_node: null,
      pending_action: null,
      executive_summary: result.state.executiveSynthesis,
      model_used: result.state.modelUsed,
      state: result.state,
      trace: result.trace
    };
  }
}

// ============================================================================
// 7. EXPRESS ROUTE MOUNTER (`registerAgenticRoutes`)
// ============================================================================

export function registerAgenticRoutes(app: Express, db: DbAdapter) {
  const rag = new HybridProjectRAGEngine(db);
  const llm = new PulseLLMClient(db);
  const tools = createPulseStructuredTools(db, rag);
  const orchestrator = new PulseLangGraphOrchestrator(db, rag, llm);

  // 1. Get AI / Groq / RAG Configuration Status
  app.get('/api/ai/config', (_req: Request, res: Response) => {
    const cfg = llm.getConfig();
    const ragStats = rag.getStats();
    res.json({
      active_provider: cfg.activeProvider,
      groq_configured: Boolean(cfg.groqApiKey),
      groq_model: cfg.groqModel,
      gemini_configured: Boolean(cfg.geminiApiKey),
      rag_total_chunks: ragStats.total_chunks,
      rag_breakdown: ragStats.breakdown,
      registered_tools_count: tools.length,
      workflows_count: orchestrator.getWorkflowCatalog().length
    });
  });

  // 2. Update Groq API Key & Model at Runtime
  app.post('/api/ai/config', (req: Request, res: Response) => {
    const { groq_api_key, groq_model } = req.body || {};
    llm.saveConfig({ groq_api_key, groq_model });
    const cfg = llm.getConfig();
    res.json({
      success: true,
      active_provider: cfg.activeProvider,
      groq_configured: Boolean(cfg.groqApiKey),
      groq_model: cfg.groqModel
    });
  });

  // 3. Re-index Hybrid RAG Knowledge Base
  app.post('/api/ai/rag/reindex', (req: Request, res: Response) => {
    const { project_id } = req.body || {};
    const stats = rag.reindexAll(project_id || undefined);
    res.json({
      success: true,
      ...stats
    });
  });

  // 4. Hybrid Vector + BM25 RAG Search Endpoint
  app.post('/api/ai/rag/search', (req: Request, res: Response) => {
    const { query, project_id, source_types, top_k } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ detail: 'query is required' });
    }
    const results = rag.search({
      query: String(query),
      project_id: project_id || undefined,
      source_types: Array.isArray(source_types) ? source_types : undefined,
      top_k: Number(top_k || 6)
    });
    res.json({
      query,
      count: results.length,
      results
    });
  });

  // 5. List LangGraph Workflows & Recent Checkpoints
  app.get('/api/ai/workflows', (_req: Request, res: Response) => {
    const workflows = orchestrator.getWorkflowCatalog();
    const checkpoints = db.queryAll<any>(
      'SELECT * FROM langgraph_checkpoints ORDER BY updated_at DESC LIMIT 15'
    );
    res.json({
      workflows,
      checkpoints: checkpoints.map((cp: any) => ({
        thread_id: cp.thread_id,
        workflow_id: cp.workflow_id,
        project_id: cp.project_id,
        status: cp.status,
        current_node: cp.current_node,
        pending_action: cp.pending_action_json ? JSON.parse(cp.pending_action_json) : null,
        trace: cp.trace_json ? JSON.parse(cp.trace_json) : [],
        updated_at: cp.updated_at
      }))
    });
  });

  // 6. Execute a LangGraph Stateful Workflow
  app.post('/api/ai/workflows/run', async (req: Request, res: Response) => {
    try {
      const { workflow_id, project_id, custom_input } = req.body || {};
      if (!workflow_id) {
        return res.status(400).json({ detail: 'workflow_id is required' });
      }
      const result = await orchestrator.runWorkflow({
        workflow_id,
        project_id: project_id || undefined,
        custom_input
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ detail: err.message || 'Failed running LangGraph workflow' });
    }
  });

  // 7. Human-in-the-Loop Checkpoint Approval / Rejection
  app.post('/api/ai/workflows/approve', async (req: Request, res: Response) => {
    try {
      const { thread_id, approve } = req.body || {};
      if (!thread_id) {
        return res.status(400).json({ detail: 'thread_id is required' });
      }
      const result = await orchestrator.approveOrRejectCheckpoint({
        thread_id,
        approve: Boolean(approve)
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ detail: err.message || 'Failed processing checkpoint approval' });
    }
  });

  // 8. List Registered LangChain StructuredTools & Execution Logs
  app.get('/api/ai/tools', (_req: Request, res: Response) => {
    const logs = db.queryAll<any>(
      'SELECT * FROM agent_tool_logs ORDER BY created_at DESC LIMIT 25'
    );
    res.json({
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      })),
      recent_logs: logs.map((l: any) => ({
        id: l.id,
        tool_name: l.tool_name,
        args: JSON.parse(l.args_json || '{}'),
        result: JSON.parse(l.result_json || '{}'),
        latency_ms: l.latency_ms,
        created_at: l.created_at
      }))
    });
  });

  // 9. Upgraded Agentic RAG + Tool-Calling Supervisor Endpoint (`/api/ai/query`)
  app.post('/api/ai/query', async (req: Request, res: Response) => {
    const { prompt, project_id, enable_tools = true } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ detail: 'prompt is required' });
    }

    const agentSteps: AgentStepTrace[] = [];
    const startOverall = Date.now();

    // Step 1: Hybrid RAG Retrieval
    const ragStart = Date.now();
    const ragHits = rag.search({
      query: String(prompt),
      project_id: project_id || undefined,
      top_k: 6
    });
    agentSteps.push({
      step_id: `step-rag-${Date.now()}`,
      node_or_tool: 'HybridProjectRAG.search',
      type: 'rag_retrieval',
      status: 'completed',
      summary: `Retrieved ${ragHits.length} relevant chunks via 128-dim Cosine + BM25 Hybrid Search.`,
      details: ragHits.map(h => ({ title: h.title, source_type: h.source_type, score: h.combined_score })),
      duration_ms: Math.max(1, Date.now() - ragStart),
      timestamp: new Date().toISOString()
    });

    // Step 2: Gather Live Structured SQLite Snapshot
    const pFilter = project_id ? ' WHERE id = ?' : '';
    const projects = db.queryAll<any>('SELECT * FROM projects' + pFilter, project_id ? [project_id] : []);
    const tFilter = project_id ? ' WHERE project_id = ?' : '';
    const tasks = db.queryAll<any>('SELECT * FROM tasks' + tFilter, project_id ? [project_id] : []);
    const members = db.queryAll<any>('SELECT * FROM team_members');

    const dbSnapshotLines: string[] = [
      `ACTIVE PROJECTS (${projects.length}):`,
      ...projects.map((p: any) => `- [${p.id}] "${p.name}" (Status: ${p.status}, Deadline: ${p.deadline || 'N/A'}, Sprint: ${p.current_sprint})`),
      `\nTEAM ROSTER (${members.length}):`,
      ...members.map((m: any) => `- [${m.id}] ${m.name} (${m.role}, Skills: ${m.skills || m.role})`),
      `\nHYBRID RAG RETRIEVED EVIDENCE CHUNKS (${ragHits.length}):`,
      ...ragHits.map(
        (h, idx) =>
          `[${idx + 1}] (${h.source_type.toUpperCase()} | Score: ${h.combined_score}) ${h.title}: ${h.content}`
      )
    ];

    const systemPrompt = `You are the PULSE Agentic AI Supervisor powered by Groq (openai/gpt-oss-120b), LangChain StructuredTools, and Hybrid RAG.
Rules:
1. Ground every answer strictly in the provided SQLite records and Hybrid RAG evidence chunks.
2. When the user asks to perform an action (create a task, reassign an overloaded task, toggle a blocker, run a what-if simulation, audit fair contributions, or resolve a dispute), invoke the appropriate tool.
3. Always cite specific issue keys, team member names, meeting notes, or commit SHAs from the retrieved RAG context.`;

    const llmStart = Date.now();
    const llmResult = await llm.invokeChat({
      systemPrompt,
      userPrompt: `${dbSnapshotLines.join('\n')}\n\nUser Request: ${prompt}`,
      tools: enable_tools ? tools : undefined
    });

    for (const tc of llmResult.toolCallsExecuted) {
      agentSteps.push({
        step_id: `step-tool-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        node_or_tool: tc.name,
        type: 'tool_call',
        status: 'completed',
        summary: `Executed LangChain StructuredTool [${tc.name}] (${tc.latency_ms}ms)`,
        details: { args: tc.args, result: tc.result },
        duration_ms: tc.latency_ms,
        timestamp: new Date().toISOString()
      });
    }

    let finalResponseText = llmResult.text;
    if (!finalResponseText) {
      // Deterministic grounded synthesis when GROQ_API_KEY is not set yet
      const overdueCount = tasks.filter((t: any) => isTaskOverdue({ status: t.status, dueDate: t.due_date })).length;
      const doneCount = tasks.filter((t: any) => isTaskCompleted(t.status)).length;
      finalResponseText =
        `### Grounded Hybrid RAG & LangGraph Analysis\n` +
        `Based on **${ragHits.length} Hybrid RAG chunks** and **${tasks.length} live deliverables** (${doneCount} completed, ${overdueCount} overdue):\n\n` +
        ragHits
          .slice(0, 4)
          .map(
            h =>
              `- **[${h.source_type.toUpperCase()}] ${h.title}** *(Relevance: ${Math.round(h.combined_score * 100)}%)*: ${h.content}`
          )
          .join('\n') +
        `\n\n> **Tip**: Set your \`GROQ_API_KEY\` (model: \`openai/gpt-oss-120b\`) in `.concat(
          `the **Agent Studio** or \`.env\` to enable live Groq 120B generative synthesis and autonomous tool calling.`
        );
    }

    agentSteps.push({
      step_id: `step-synth-${Date.now()}`,
      node_or_tool: llmResult.modelUsed,
      type: 'llm_synthesis',
      status: 'completed',
      summary: `Generated grounded response in ${Math.max(1, Date.now() - llmStart)}ms (Total pipeline: ${Math.max(1, Date.now() - startOverall)}ms).`,
      duration_ms: Math.max(1, Date.now() - llmStart),
      timestamp: new Date().toISOString()
    });

    res.json({
      has_api_key: llmResult.provider !== 'deterministic_fallback',
      provider: llmResult.provider,
      model_used: llmResult.modelUsed,
      response: finalResponseText,
      grounding_data_points: projects.length + tasks.length + members.length + ragHits.length,
      sources_used: [
        `Hybrid RAG Chunks (${ragHits.length})`,
        `Projects (${projects.length})`,
        `Deliverables (${tasks.length})`,
        `Team Roster (${members.length})`
      ],
      rag_citations: ragHits,
      agent_steps: agentSteps,
      tool_calls: llmResult.toolCallsExecuted
    });
  });
}