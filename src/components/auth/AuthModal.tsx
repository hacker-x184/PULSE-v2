import React, { useState, useEffect } from 'react';
import { Lock, Mail, User as UserIcon, Briefcase, AlertCircle, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../api/client';
import { User } from '../../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: User) => void;
  initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login'
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('Member');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, initialMode]);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setName('');
    setRole('Member');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleDemoLogin = async (demoEmail: string, demoPass: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.login({ email: demoEmail, password: demoPass });
      setSuccessMessage(`Welcome back, ${res.user.name}`);
      setTimeout(() => {
        onAuthSuccess(res.user);
        onClose();
        resetForm();
      }, 500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Demo login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      if (mode === 'login') {
        const res = await api.login({ email, password });
        setSuccessMessage(`Welcome back, ${res.user.name}!`);
        setTimeout(() => {
          onAuthSuccess(res.user);
          onClose();
          resetForm();
        }, 500);
      } else if (mode === 'register') {
        if (!name.trim()) {
          setErrorMessage('Full name is required');
          setIsLoading(false);
          return;
        }
        const res = await api.register({
          name: name.trim(),
          email: email.trim(),
          password,
          role
        });
        setSuccessMessage(`Account created successfully! Logged in as ${res.user.name}`);
        setTimeout(() => {
          onAuthSuccess(res.user);
          onClose();
          resetForm();
        }, 600);
      } else {
        await api.resetPassword(email.trim(), password);
        setSuccessMessage('Password updated successfully! Please sign in with your new credentials.');
        setTimeout(() => {
          setMode('login');
          setPassword('');
          setErrorMessage(null);
        }, 1500);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Operation failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        resetForm();
      }}
      title={
        mode === 'login'
          ? 'Platform Authentication'
          : mode === 'register'
          ? 'Create Enterprise Account'
          : 'Reset Account Password'
      }
      subtitle={
        mode === 'login'
          ? 'Sign in to access your assigned deliverables, projects, and risk metrics.'
          : mode === 'register'
          ? 'Register a new team workspace identity with SQLite persistence.'
          : 'Set a new password for your registered corporate account.'
      }
    >
      <div className="space-y-4">
        {/* Tab switchers - Only Sign In and Register */}
        {mode !== 'reset' ? (
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`pb-2.5 px-3 sm:px-4 text-xs font-semibold border-b-2 transition-colors ${
                mode === 'login'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`pb-2.5 px-3 sm:px-4 text-xs font-semibold border-b-2 transition-colors ${
                mode === 'register'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Register
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
            <span className="text-xs font-bold text-slate-900">Reset Account Password</span>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold hover:underline"
            >
              ← Back to Sign In
            </button>
          </div>
        )}

        {/* Notifications */}
        {errorMessage && (
          <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name *
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Zaid Tested"
                    className="w-full pl-9 pr-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Workspace Role
                </label>
                <div className="relative">
                  <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Team Leader">Team Leader (Project & Team Leadership)</option>
                    <option value="Member">Team Member (Developer / Contributor)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email Address *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@enterprise.internal"
                className="w-full pl-9 pr-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {mode === 'reset' ? 'New Password * (min 6 characters)' : 'Password * (min 6 characters)'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            {/* "Forgot Password?" link on the right side, directly below the password field on the Sign-In page */}
            {mode === 'login' && (
              <div className="flex justify-end mt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span>Processing...</span>
            ) : (
              <>
                <span>{mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Reset Password'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* 1-Click Fast Demo Login for Evaluation */}
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>Fast 1-Click Demo Profiles (Pre-seeded):</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleDemoLogin('zaidtested@gmail.com', 'password123')}
              className="text-left p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors group"
            >
              <div className="text-xs font-semibold text-slate-900 group-hover:text-blue-600">
                Zaid Tested
              </div>
              <div className="text-[10px] text-blue-700 font-medium">Team Leader</div>
              <div className="text-[9px] text-slate-400 font-mono mt-0.5">zaidtested@gmail.com</div>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleDemoLogin('elena.rostova@enterprise.internal', 'password123')}
              className="text-left p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors group"
            >
              <div className="text-xs font-semibold text-slate-900 group-hover:text-blue-600">
                Elena Rostova
              </div>
              <div className="text-[10px] text-blue-700 font-medium">Team Leader</div>
              <div className="text-[9px] text-slate-400 font-mono mt-0.5">elena.rostova@enterprise.internal</div>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
