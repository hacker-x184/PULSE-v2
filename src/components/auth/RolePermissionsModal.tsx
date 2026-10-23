import React from 'react';
import { ShieldCheck, Check, X, Info } from 'lucide-react';
import { Modal } from '../common/Modal';

interface RolePermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RolePermissionsModal: React.FC<RolePermissionsModalProps> = ({ isOpen, onClose }) => {
  const permissions = [
    { capability: 'Create & Edit Projects', teamLeader: true, member: false },
    { capability: 'Archive & Delete Projects', teamLeader: true, member: false },
    { capability: 'Create & Assign Deliverable Tasks', teamLeader: true, member: true },
    { capability: 'Change Task Status & Story Points', teamLeader: true, member: true },
    { capability: 'Transfer Project Leadership', teamLeader: true, member: false },
    { capability: 'Monitor Member Work Status & Progress', teamLeader: true, member: false },
    { capability: 'Approve Task Architecture Reviews', teamLeader: true, member: false },
    { capability: 'Manage Team Member Directory & Capacities', teamLeader: true, member: false },
    { capability: 'Resolve Contribution Score Disputes', teamLeader: true, member: false },
    { capability: 'Execute Smart Task Redistribution', teamLeader: true, member: false },
    { capability: 'Run What-If Project Recovery Simulations', teamLeader: true, member: true },
    { capability: 'Configure Custom Contribution Weights', teamLeader: true, member: false },
    { capability: 'Connect GitHub Repositories & Sync Commits', teamLeader: true, member: true },
    { capability: 'Export RFC 4180 CSV & Calendar (.ics)', teamLeader: true, member: true },
    { capability: 'Download Full Database Backup Snapshot', teamLeader: true, member: false },
    { capability: 'Reset Demo Database to Initial Fixtures', teamLeader: true, member: false },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Role-Based Access Control (RBAC) Matrix"
      subtitle="Combined Team Leader authority (merging Admin and Manager responsibilities) and Team Member capabilities."
    >
      <div className="space-y-4">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5 text-xs text-blue-900">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <span>
            PULSE enforces unified role-based governance: <strong>Team Leaders</strong> hold all managerial, administrative, and leadership capabilities, while <strong>Team Members</strong> execute, track, and complete assigned deliverables.
          </span>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
          <table className="w-full text-left divide-y divide-slate-200">
            <thead className="bg-slate-50 text-slate-700 font-semibold">
              <tr>
                <th className="p-3">Platform Capability</th>
                <th className="p-3 text-center w-36 text-amber-700">Team Leader</th>
                <th className="p-3 text-center w-36 text-slate-600">Team Member</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {permissions.map((p, idx) => (
                <tr key={idx} className="hover:bg-slate-50/70">
                  <td className="p-3 font-medium text-slate-900">{p.capability}</td>
                  <td className="p-3 text-center">
                    {p.teamLeader ? (
                      <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-slate-300 mx-auto" />
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {p.member ? (
                      <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-slate-300 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Close Matrix
          </button>
        </div>
      </div>
    </Modal>
  );
};
