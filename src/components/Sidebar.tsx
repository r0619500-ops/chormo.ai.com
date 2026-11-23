import { useMemo, useState } from 'react';
import {
  ImagePlus,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { Conversation, UserProfile } from '../types/chat';
import { ChromoLogo } from './ChromoLogo';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  profile: UserProfile;
  desktopOpen: boolean;
  mobileOpen: boolean;
  onCloseDesktop: () => void;
  onCloseMobile: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onOpenImageCreator: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
}

function getDateBucket(timestamp: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 86_400_000;

  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfToday - oneDay) return 'Yesterday';
  if (timestamp >= startOfToday - 7 * oneDay) return 'Previous 7 days';
  return 'Older';
}

export function Sidebar({
  conversations,
  activeId,
  profile,
  desktopOpen,
  mobileOpen,
  onCloseDesktop,
  onCloseMobile,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onOpenImageCreator,
  onOpenSettings,
  onOpenProfile,
}: SidebarProps) {
  const [query, setQuery] = useState('');

  const groupedConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...conversations]
      .filter((c) => {
        if (!normalizedQuery) return true;
        if (c.title.toLowerCase().includes(normalizedQuery)) return true;
        return c.messages.some((m) => m.content.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const groups: Array<{ label: string; items: Conversation[] }> = [];
    for (const chat of sorted) {
      const label = getDateBucket(chat.updatedAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.label === label) {
        lastGroup.items.push(chat);
      } else {
        groups.push({ label, items: [chat] });
      }
    }
    return groups;
  }, [conversations, query]);

  const handleClose = () => {
    if (window.innerWidth < 768) {
      onCloseMobile();
    } else {
      onCloseDesktop();
    }
  };

  const initials = (profile.name.trim() || 'O')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-[#02050d]/70 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="CHORMO AI Navigation"
        className={[
          'fixed inset-y-0 left-0 z-40 flex flex-col w-[276px] shrink-0',
          'bg-[#060d1f]/85 backdrop-blur-2xl border-r border-cyan-400/15',
          'shadow-[8px_0_32px_rgba(0,0,0,0.45)]',
          'transition-transform duration-200 ease-out',
          'md:static',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          desktopOpen ? 'md:translate-x-0 md:ml-0' : 'md:-ml-[276px] md:translate-x-0',
        ].join(' ')}
      >
        {/* Sidebar Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-cyan-400/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ChromoLogo size="sm" />
            <span className="font-display font-bold text-[15px] tracking-tight text-sky-50 whitespace-nowrap shrink-0">
              CHORMO AI
            </span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-cyan-200 hover:bg-cyan-400/10 transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* New Chat + Search */}
        <div className="px-3.5 pt-3.5 pb-2 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={onNewChat}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-cyan-400/30 bg-gradient-to-r from-cyan-500/15 via-sky-500/10 to-transparent hover:from-cyan-500/25 hover:border-cyan-300/50 text-sky-50 text-sm font-medium flex items-center gap-2.5 transition-all duration-150 shadow-[0_0_18px_rgba(34,211,238,0.1)] hover:shadow-[0_0_24px_rgba(34,211,238,0.2)] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-cyan-300 shrink-0" />
            <span>New Chat</span>
          </button>

          {conversations.length > 0 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-cyan-400/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chat history"
                aria-label="Search chat history"
                className="w-full h-9 pl-8 pr-8 rounded-xl bg-[#040916]/80 border border-cyan-400/15 focus:border-cyan-400/45 text-xs text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-cyan-200 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Chat History List */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4" aria-label="Chat History">
          {groupedConversations.length === 0 ? (
            <div className="px-2.5 py-6 text-center">
              <MessageSquare className="w-5 h-5 text-cyan-400/35 mx-auto mb-2" />
              <p className="text-xs text-slate-400">
                {query ? 'No matching conversations.' : 'Your conversations will appear here.'}
              </p>
            </div>
          ) : (
            groupedConversations.map((group) => (
              <div key={group.label}>
                <div className="px-2.5 pb-1.5 text-[11px] font-medium text-cyan-300/60">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((chat) => {
                    const isActive = chat.id === activeId;
                    return (
                      <div
                        key={chat.id}
                        className={[
                          'group flex items-center justify-between gap-2 rounded-xl px-2.5 min-h-[40px] text-[13.5px] transition-all duration-150 cursor-pointer border',
                          isActive
                            ? 'bg-cyan-400/12 border-cyan-400/30 text-sky-50 font-medium shadow-[0_0_16px_rgba(34,211,238,0.08)]'
                            : 'border-transparent text-slate-300 hover:bg-white/[0.04] hover:border-cyan-400/15 hover:text-white',
                        ].join(' ')}
                        onClick={() => {
                          onSelectChat(chat.id);
                          onCloseMobile();
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectChat(chat.id);
                            onCloseMobile();
                          }
                        }}
                      >
                        <MessageSquare
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? 'text-cyan-300' : 'text-slate-500 group-hover:text-cyan-400/70'
                          }`}
                        />
                        <span className="truncate flex-1">{chat.title || 'New conversation'}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChat(chat.id);
                          }}
                          aria-label={`Delete ${chat.title || 'conversation'}`}
                          title="Delete chat"
                          className={[
                            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-slate-400 hover:text-red-300 hover:bg-red-500/15 transition-all cursor-pointer',
                            isActive
                              ? 'opacity-100'
                              : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100',
                          ].join(' ')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Bottom System Navigation: Image Creator, Settings & User Profile */}
        <div className="p-3 border-t border-cyan-400/12 space-y-1.5 shrink-0 bg-[#040917]/60">
          <button
            type="button"
            onClick={() => {
              onOpenImageCreator();
              onCloseMobile();
            }}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-[13.5px] text-slate-300 hover:text-sky-50 hover:bg-cyan-400/10 border border-transparent hover:border-cyan-400/20 flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ImagePlus className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Image Creator</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onOpenSettings();
              onCloseMobile();
            }}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-[13.5px] text-slate-300 hover:text-sky-50 hover:bg-cyan-400/10 border border-transparent hover:border-cyan-400/20 flex items-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Settings className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Settings</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onOpenProfile();
              onCloseMobile();
            }}
            className="w-full min-h-[44px] px-2.5 py-2 rounded-xl text-left hover:bg-cyan-400/10 border border-transparent hover:border-cyan-400/20 flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg border border-cyan-400/35 bg-cyan-500/15 flex items-center justify-center text-xs font-display font-bold text-cyan-200 shrink-0">
              {initials || <User className="w-4 h-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-slate-100 truncate">
                {profile.name}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {profile.role}
              </div>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
}
