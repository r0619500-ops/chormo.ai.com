import React, { useEffect, useState } from 'react';
import { Check, User, X } from 'lucide-react';
import type { UserProfile } from '../types/chat';

interface ProfileModalProps {
  isOpen: boolean;
  profile: UserProfile;
  conversationCount: number;
  messageCount: number;
  onSaveProfile: (next: UserProfile) => void;
  onClose: () => void;
}

export function ProfileModal({
  isOpen,
  profile,
  conversationCount,
  messageCount,
  onSaveProfile,
  onClose,
}: ProfileModalProps) {
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role);
  const [greetingNote, setGreetingNote] = useState(profile.greetingNote);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(profile.name);
      setRole(profile.role);
      setGreetingNote(profile.greetingNote);
      setSaved(false);
    }
  }, [isOpen, profile]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const initials = (name.trim() || 'O')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile({
      name: name.trim() || 'Operator',
      role: role.trim() || 'Primary Access',
      greetingNote: greetingNote.trim() || 'Ready for your next command or question.',
    });
    setSaved(true);
    window.setTimeout(() => {
      setSaved(false);
      onClose();
    }, 500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="User Profile"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02050d]/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-[#071124]/95 shadow-[0_0_50px_rgba(6,182,212,0.16)] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-cyan-400/15 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <User className="w-4 h-4 text-cyan-400" />
            <h2 className="font-display text-base font-semibold text-sky-50">
              User Profile
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Identity Preview */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/25 to-blue-600/20 flex items-center justify-center font-display font-bold text-lg text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.18)] shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-white truncate">
                {name.trim() || 'Operator'}
              </div>
              <div className="text-xs text-cyan-300/80 truncate">
                {role.trim() || 'Primary Access'}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
                <span>{conversationCount} chats</span>
                <span aria-hidden="true">·</span>
                <span>{messageCount} messages</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="profile-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                Display Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Enter your name"
                className="w-full h-10 px-3.5 rounded-xl bg-[#040a17] border border-cyan-400/20 focus:border-cyan-400/60 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="profile-role" className="block text-xs font-medium text-slate-300 mb-1.5">
                Title or Role
              </label>
              <input
                id="profile-role"
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                maxLength={48}
                placeholder="e.g. Engineer, Designer, Researcher"
                className="w-full h-10 px-3.5 rounded-xl bg-[#040a17] border border-cyan-400/20 focus:border-cyan-400/60 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="profile-note" className="block text-xs font-medium text-slate-300 mb-1.5">
                Home Screen Subtitle
              </label>
              <input
                id="profile-note"
                type="text"
                value={greetingNote}
                onChange={(e) => setGreetingNote(e.target.value)}
                maxLength={90}
                placeholder="Ready for your next command or question."
                className="w-full h-10 px-3.5 rounded-xl bg-[#040a17] border border-cyan-400/20 focus:border-cyan-400/60 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3 border-t border-cyan-400/10">
            <span className="text-xs text-slate-400">
              CHORMO AI · Meet Shasane
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#03060f] text-xs font-semibold transition-colors shadow-[0_0_20px_rgba(34,211,238,0.3)] cursor-pointer whitespace-nowrap"
            >
              {saved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved</span>
                </>
              ) : (
                <span>Save Profile</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
