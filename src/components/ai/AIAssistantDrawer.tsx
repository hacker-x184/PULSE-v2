import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Send,
  Bot,
  User,
  Database,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  FolderKanban,
  HelpCircle,
  FileText,
  Upload,
  Trash2,
  GitBranch,
  Play,
  AlertTriangle,
  FileCheck,
  Clock,
  Layers,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { api } from '../../api/client';

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProjectId: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  hasApiKey?: boolean;
  modelUsed?: string;
  groundingDataPoints?: number;
  sourcesUsed?: string[];
}

const SUGGESTIONS = [
  'Summarize active deliverables & sprint progress',
  'Identify overloaded team members or bottlenecks',
  'Check critical path risks and upcoming deadlines',
  'Provide an overview of team contribution metrics'
];

type ActiveTab = 'chat' | 'documents' | 'workflows' | 'github';

export const AIAssistantDrawer: React.FC<AIAssistantDrawerProps> = ({
  isOpen,
  onClose,
  selectedProjectId
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      sender: 'assistant',
      text: 'Hello! I am your PULSE Intelligence Assistant powered by Groq (openai/gpt-oss-120b). My responses are grounded in real SQLite database records, verified GitHub commits, and ingested PDF knowledge chunks. How can I assist your project today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelUsed: 'openai/gpt-oss-120b',
      groundingDataPoints: 0,
      sourcesUsed: ['Local SQLite Database Records']
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Documents / RAG State
  const [documents, setDocuments] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Workflows & Approvals State
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [isStartingWorkflow, setIsStartingWorkflow] = useState(false);
  const [workflowActionMsg, setWorkflowActionMsg] = useState<string | null>(null);
  const [selectedDocForPlanner, setSelectedDocForPlanner] = useState<string>('');

  // GitHub Investigator State
  const [investigatorQuestion, setInvestigatorQuestion] = useState('Who contributed to the core ledger architecture and settlement engine?');
  const [investigatorReport, setInvestigatorReport] = useState<any | null>(null);
  const [isInvestigating, setIsInvestigating] = useState(false);

  const effectiveProjectId = selectedProjectId || 'p-ledger';

  const loadDocuments = async () => {
    try {
      const docs = await api.getDocuments(effectiveProjectId);
      setDocuments(docs);
      if (docs.length > 0 && !selectedDocForPlanner) {
        setSelectedDocForPlanner(docs[0].id);
      }
    } catch {
      // Ignored
    }
  };

  const loadWorkflows = async () => {
    try {
      const wfs = await api.getWorkflows(effectiveProjectId);
      setWorkflows(wfs);
    } catch {
      // Ignored
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDocuments();
      loadWorkflows();
    }
  }, [isOpen, effectiveProjectId]);

  useEffect(() => {
    if (isOpen && activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages, activeTab]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSend = async (promptToSend?: string) => {
    const text = (promptToSend || inputPrompt).trim();
    if (!text || isLoading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMessage]);
    setInputPrompt('');
    setIsLoading(true);

    try {
      const res = await api.queryAI({ prompt: text, project_id: effectiveProjectId });
      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'assistant',
        text: res.response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        hasApiKey: res.has_api_key,
        modelUsed: res.model_used || 'openai/gpt-oss-120b',
        groundingDataPoints: res.grounding_data_points,
        sourcesUsed: res.sources_used
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: `Unable to complete query: ${err.message || 'Server connection error'}. Core platform features remain unaffected.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        hasApiKey: false,
        groundingDataPoints: 0,
        sourcesUsed: []
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const res = await api.uploadDocument({
            project_id: effectiveProjectId,
            filename: file.name,
            file_type: file.type || 'application/pdf',
            file_base64: base64Data
          });
          setUploadSuccess(`Indexed "${file.name}": ${res.chunks_indexed} vector chunks (${res.page_count} pages).`);
          loadDocuments();
        } catch (uploadErr: any) {
          setUploadError(uploadErr.message || 'Failed to process document');
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err.message || 'Failed reading file');
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await api.deleteDocument(docId);
      loadDocuments();
    } catch (err: any) {
      alert(`Could not delete document: ${err.message}`);
    }
  };

  const handleStartWorkflow = async (workflowType: string) => {
    setIsStartingWorkflow(true);
    setWorkflowActionMsg(null);
    try {
      const payload: any = {
        workflow_type: workflowType,
        project_id: effectiveProjectId
      };
      if (workflowType === 'document_planner' && selectedDocForPlanner) {
        payload.document_id = selectedDocForPlanner;
      }
      const res = await api.startWorkflow(payload);
      setWorkflowActionMsg(`Workflow ${res.workflow_id} started. Status: ${res.status}.`);
      loadWorkflows();
    } catch (err: any) {
      setWorkflowActionMsg(`Error starting workflow: ${err.message}`);
    } finally {
      setIsStartingWorkflow(false);
    }
  };

  const handleApproveWorkflow = async (workflowId: string) => {
    try {
      const res = await api.approveWorkflow(workflowId);
      setWorkflowActionMsg(`Approved & Executed: ${res.message}`);
      loadWorkflows();
    } catch (err: any) {
      setWorkflowActionMsg(`Approval failed: ${err.message}`);
    }
  };

  const handleRejectWorkflow = async (workflowId: string) => {
    try {
      await api.rejectWorkflow(workflowId);
      setWorkflowActionMsg(`Workflow ${workflowId} was rejected.`);
      loadWorkflows();
    } catch (err: any) {
      setWorkflowActionMsg(`Reject failed: ${err.message}`);
    }
  };

  const handleRunInvestigation = async () => {
    if (!investigatorQuestion.trim() || isInvestigating) return;
    setIsInvestigating(true);
    try {
      const res = await api.investigateGitHub({
        project_id: effectiveProjectId,
        question: investigatorQuestion.trim()
      });
      setInvestigatorReport(res);
    } catch (err: any) {
      alert(`Investigation failed: ${err.message}`);
    } finally {
      setIsInvestigating(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl bg-[var(--surface-primary)] border-l border-[var(--border-color)] shadow-2xl flex flex-col h-full transform transition-transform duration-300">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-[var(--border-color)] flex items-center justify-between bg-[var(--surface-secondary)]/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--primary-accent)]/15 border border-[var(--primary-accent)]/30 flex items-center justify-center text-[var(--primary-accent)]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    PULSE AI Assistant
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                    openai/gpt-oss-120b
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                  <FolderKanban className="w-3 h-3 text-[var(--text-muted)]" />
                  Project: <span className="font-semibold">{effectiveProjectId}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClose}
                title="Close Drawer"
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="px-4 border-b border-[var(--border-color)] bg-[var(--surface-primary)] flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'chat'
                  ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Grounded Chat
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('documents')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'documents'
                  ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Knowledge RAG ({documents.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('workflows')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'workflows'
                  ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              LangGraph Workflows ({workflows.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('github')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'github'
                  ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              GitHub Attribution
            </button>
          </div>

          {/* TAB 1: Grounded Chat */}
          {activeTab === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.sender === 'assistant' && (
                      <div className="w-8 h-8 rounded-lg bg-[var(--primary-accent)]/15 border border-[var(--primary-accent)]/30 flex items-center justify-center text-[var(--primary-accent)] shrink-0 mt-0.5">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-[var(--primary-accent)] text-white rounded-br-xs'
                          : 'bg-[var(--surface-secondary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-bl-xs'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.text}</div>

                      {msg.sender === 'assistant' && (
                        <div className="mt-2.5 pt-2 border-t border-[var(--border-color)]/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {msg.modelUsed && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--surface-tertiary)] font-mono text-[10px]">
                                {msg.modelUsed}
                              </span>
                            )}
                            {msg.groundingDataPoints !== undefined && msg.groundingDataPoints > 0 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                                <ShieldCheck className="w-3 h-3 text-emerald-500" />
                                {msg.groundingDataPoints} data points
                              </span>
                            )}
                            {msg.sourcesUsed && msg.sourcesUsed.length > 0 && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                Sources: {msg.sourcesUsed.join(', ')}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 ml-auto">
                            <span>{msg.timestamp}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.id, msg.text)}
                              title="Copy response"
                              className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            >
                              {copiedId === msg.id ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {msg.sender === 'user' && (
                        <div className="mt-1 text-right text-[10px] text-white/70">
                          {msg.timestamp}
                        </div>
                      )}
                    </div>

                    {msg.sender === 'user' && (
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface-tertiary)] border border-[var(--border-color)] flex items-center justify-center text-[var(--text-secondary)] shrink-0 mt-0.5">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-lg bg-[var(--primary-accent)]/15 border border-[var(--primary-accent)]/30 flex items-center justify-center text-[var(--primary-accent)] shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-2xl rounded-bl-xs px-4 py-3 text-xs text-[var(--text-secondary)] flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--primary-accent)] animate-ping" />
                      <span>Synthesizing database records & generating grounded insight via Groq...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Quick Suggestions */}
              {messages.length <= 2 && (
                <div className="px-4 py-2 border-t border-[var(--border-color)]/50 bg-[var(--surface-secondary)]/30">
                  <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5 uppercase tracking-wider flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" /> Suggested queries
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((suggestion, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSend(suggestion)}
                        className="text-left text-[11px] px-2.5 py-1 rounded-lg bg-[var(--surface-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--primary-accent)]/40 transition-colors cursor-pointer"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input Box */}
              <div className="p-4 border-t border-[var(--border-color)] bg-[var(--surface-primary)]">
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleSend();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={inputPrompt}
                    onChange={e => setInputPrompt(e.target.value)}
                    placeholder="Ask about deliverables, risks, workloads, or project documents..."
                    disabled={isLoading}
                    className="flex-1 px-3.5 py-2.5 text-xs text-[var(--text-primary)] bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]/30 placeholder-[var(--text-muted)]"
                  />
                  <button
                    type="submit"
                    disabled={!inputPrompt.trim() || isLoading}
                    className="px-4 py-2.5 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-sm"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </>
          )}

          {/* TAB 2: Knowledge RAG & PDF Ingestion */}
          {activeTab === 'documents' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-[var(--primary-accent)]" />
                  PDF & Requirements Document Ingestion
                </h4>
                <p className="text-xs text-[var(--text-secondary)]">
                  Upload project requirements specifications or meeting notes (PDF, TXT). Text is extracted using a real parser, split into page-aware chunks, and embedded with local 384-dimensional dense vectors.
                </p>
              </div>

              {/* Upload Box */}
              <div className="border-2 border-dashed border-[var(--border-color)] rounded-xl p-6 text-center hover:border-[var(--primary-accent)]/50 transition-colors bg-[var(--surface-secondary)]/30">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,.txt,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-10 h-10 mx-auto rounded-full bg-[var(--primary-accent)]/10 text-[var(--primary-accent)] flex items-center justify-center mb-2">
                  <Upload className="w-5 h-5" />
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isUploading ? 'Parsing & Embedding Vectors...' : 'Select PDF or Document'}
                </button>
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  PDF, TXT, or Markdown up to 25MB. Real page preservation and vector similarity.
                </p>
              </div>

              {uploadSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{uploadSuccess}</span>
                </div>
              )}

              {uploadError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Ingested Documents List */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Ingested Knowledge Base Records ({documents.length})
                </div>

                {documents.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-secondary)]/20 rounded-xl border border-[var(--border-color)]">
                    No documents ingested yet for project {effectiveProjectId}. Upload a requirements PDF to activate full RAG vector retrieval.
                  </div>
                ) : (
                  documents.map(doc => (
                    <div
                      key={doc.id}
                      className="p-3.5 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <FileCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            {doc.filename}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2">
                            <span>{doc.page_count} Pages</span>
                            <span>•</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                              {doc.chunks_count} Vector Chunks
                            </span>
                            <span>•</span>
                            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="p-1.5 text-[var(--text-muted)] hover:text-rose-500 transition-colors cursor-pointer"
                        title="Delete Document & Chunks"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: LangGraph Workflows & Approvals */}
          {activeTab === 'workflows' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-[var(--primary-accent)]" />
                  LangGraph Agent Workflows with Human-in-the-Loop Sign-off
                </h4>
                <p className="text-xs text-[var(--text-secondary)]">
                  Executes stateful workflows with pause-for-approval boundaries. No project writes occur until you inspect the proposal and explicitly sign off.
                </p>
              </div>

              {/* Action Buttons to Launch Workflows */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleStartWorkflow('recovery_planner')}
                  disabled={isStartingWorkflow}
                  className="p-3.5 bg-[var(--surface-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-accent)]/50 rounded-xl text-left transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--primary-accent)] flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5 text-amber-500" />
                      Recovery Planner
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">Requires Approval</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Diagnose overdue tasks & blockers, calculate workload rebalancing, and formulate an actionable mitigation plan.
                  </p>
                </button>

                <div className="p-3.5 bg-[var(--surface-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-accent)]/50 rounded-xl text-left transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5 text-blue-500" />
                      Document Planner
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">Requires Approval</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2.5">
                    Convert requirements specifications into deliverables, subtasks, story points, and skill-matched assignees.
                  </p>
                  
                  {documents.length > 0 ? (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-medium text-[var(--text-muted)] block">
                        Source Document:
                      </label>
                      <select
                        value={selectedDocForPlanner}
                        onChange={(e) => setSelectedDocForPlanner(e.target.value)}
                        className="w-full text-xs p-1.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-hidden"
                      >
                        {documents.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.filename} ({d.page_count}p)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleStartWorkflow('document_planner')}
                        disabled={isStartingWorkflow}
                        className="w-full mt-2 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isStartingWorkflow ? 'Starting Planner...' : 'Analyze Selected Document'}
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[var(--text-muted)] p-2 bg-[var(--surface-primary)] rounded-lg border border-[var(--border-color)]">
                      Upload a requirements document in the "Knowledge RAG" tab first to run this workflow.
                    </div>
                  )}
                </div>
              </div>

              {workflowActionMsg && (
                <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-lg text-xs text-[var(--text-primary)]">
                  {workflowActionMsg}
                </div>
              )}

              {/* Workflow Instances & Approval Cards */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Recent Workflow Executions ({workflows.length})
                </div>

                {workflows.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-secondary)]/20 rounded-xl border border-[var(--border-color)]">
                    No active or historical workflows found. Start a Recovery Planner or Document Planner above.
                  </div>
                ) : (
                  workflows.map(wf => {
                    let plan: any = null;
                    try {
                      if (wf.plan_json) plan = JSON.parse(wf.plan_json);
                    } catch {}

                    return (
                      <div
                        key={wf.id}
                        className={`p-4 rounded-xl border transition-all ${
                          wf.status === 'WAITING_APPROVAL'
                            ? 'bg-amber-500/5 border-amber-500/30'
                            : 'bg-[var(--surface-secondary)] border-[var(--border-color)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                              {wf.workflow_type}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                wf.status === 'WAITING_APPROVAL'
                                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                  : wf.status === 'COMPLETED'
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {wf.status}
                            </span>
                          </div>

                          {wf.plan_hash && (
                            <span className="text-[10px] font-mono text-[var(--text-muted)]">
                              Hash: {wf.plan_hash}
                            </span>
                          )}
                        </div>

                        {/* Proposed Plan Details */}
                        {plan && (
                          <div className="mt-2 p-3 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg text-xs space-y-2">
                            <div className="font-semibold text-[var(--text-primary)]">
                              Proposed Plan Details:
                            </div>
                            {plan.proposed_actions && plan.proposed_actions.map((act: any, i: number) => (
                              <div key={i} className="text-[11px] text-[var(--text-secondary)] pl-2 border-l-2 border-amber-500">
                                <span className="font-semibold">{act.type}:</span> {act.task_title || act.task_id} → {act.to_member_name || act.recommended_resolution}
                              </div>
                            ))}
                            {plan.proposed_tasks && plan.proposed_tasks.map((t: any, i: number) => (
                              <div key={i} className="text-[11px] text-[var(--text-secondary)] pl-2 border-l-2 border-blue-500">
                                <span className="font-semibold">Deliverable:</span> {t.title} ({t.priority}, {t.estimated_hours}h) → Assignee: {t.assignee_name || 'Unassigned'}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Approval Controls */}
                        {wf.status === 'WAITING_APPROVAL' && (
                          <div className="mt-3 pt-3 border-t border-[var(--border-color)] flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleRejectWorkflow(wf.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            >
                              Reject Plan
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproveWorkflow(wf.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Approve & Execute Mutations
                            </button>
                          </div>
                        )}

                        {wf.status === 'COMPLETED' && wf.approved_at && (
                          <div className="mt-2 text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                            <ShieldCheck className="w-3 h-3" /> Approved and verified in database records
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: GitHub Attribution Investigator */}
          {activeTab === 'github' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <GitBranch className="w-4 h-4 text-[var(--primary-accent)]" />
                  GitHub Contribution Investigator
                </h4>
                <p className="text-xs text-[var(--text-secondary)]">
                  Investigates verified commits, pull requests, and code attribution. Enforces strict engineering standards: separates authors from committers, maps verified PULSE members, and does not evaluate effort by lines changed.
                </p>
              </div>

              {/* Search Form */}
              <div className="space-y-2">
                <input
                  type="text"
                  value={investigatorQuestion}
                  onChange={e => setInvestigatorQuestion(e.target.value)}
                  placeholder="Enter investigation question (e.g. Who committed to the IAM provider?)..."
                  className="w-full px-3.5 py-2 text-xs text-[var(--text-primary)] bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]/30"
                />
                <button
                  type="button"
                  onClick={handleRunInvestigation}
                  disabled={isInvestigating}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-xl transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  {isInvestigating ? 'Querying Git Evidence...' : 'Run Investigation'}
                </button>
              </div>

              {/* Investigation Results */}
              {investigatorReport && (
                <div className="space-y-4">
                  <div className="p-4 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--text-primary)]">Evidence Grounding:</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        Confidence: {investigatorReport.confidence}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="p-2 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg">
                        <div className="text-lg font-bold text-[var(--text-primary)] font-mono">
                          {investigatorReport.evidence_found.commits_count}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">Verified Commits</div>
                      </div>
                      <div className="p-2 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg">
                        <div className="text-lg font-bold text-[var(--text-primary)] font-mono">
                          {investigatorReport.evidence_found.prs_count}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">Verified Pull Requests</div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                        Attribution Invariants:
                      </div>
                      {investigatorReport.attribution_notes.map((note: string, i: number) => (
                        <div key={i} className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>

                    {/* Commit Samples */}
                    {investigatorReport.evidence_found.sample_commits.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                        <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                          Verified Commit Citations:
                        </div>
                        {investigatorReport.evidence_found.sample_commits.map((c: any) => (
                          <div
                            key={c.sha}
                            className="p-2.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg text-[11px] space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold">
                                {c.sha}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {c.mapped_pulse_member} (@{c.author_login})
                              </span>
                            </div>
                            <div className="text-[var(--text-primary)]">{c.message}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
