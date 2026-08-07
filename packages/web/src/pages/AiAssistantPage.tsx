import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import * as api from '../api';
import type { AiChatTurn } from '../api';
import { MarkdownView } from '../components/MarkdownView';
import { HelpHotspot } from '../components/HelpHotspot';

const SUGGESTIONS = [
  'Which FMS needs attention right now?',
  'What is causing the most delays?',
  'Show me overdue records for today',
  'Any data quality issues right now?',
];

// v1 is stateless by design (see plan §"M7 — Chat") — this component's own state IS the entire
// conversation; nothing is persisted server-side, so a refresh starts a fresh chat.
export function AiAssistantPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<AiChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function send(text: string) {
    if (!token || sending || !text.trim()) return;
    const question = text.trim();
    const history = messages;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setSending(true);
    const res = await api.aiChat(token, question, history);
    setSending(false);
    if (!res.ok) {
      toast.error(res.message);
      setMessages((m) => [...m, { role: 'assistant', text: `Sorry, something went wrong: ${res.message}` }]);
      return;
    }
    setMessages((m) => [...m, { role: 'assistant', text: res.data.text }]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  return (
    <div className="ai-chat-page">
      <div className="ai-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <i className="fas fa-robot" />
            <div className="ai-empty-title">Ask me anything about your connected FMS</div>
            <div className="ai-empty-sub">I only answer from real, current data — never a guess.</div>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ai-suggestion-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'ai-msg ' + (m.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant')}>
            {m.role === 'assistant' ? <MarkdownView text={m.text} /> : m.text}
          </div>
        ))}
        {sending && (
          <div className="ai-msg ai-msg-assistant ai-msg-typing">
            <span /><span /><span />
          </div>
        )}
      </div>
      <div className="ai-input-bar">
        <input
          type="text" placeholder="Ask a question…" value={input}
          onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={sending}
        />
        <button className="btn btn-primary" disabled={sending || !input.trim()} onClick={() => send(input)}>
          <i className="fas fa-paper-plane" />
        </button>
        <HelpHotspot inline title="AI Assistant"
          en="Answers only from real, current dashboard data — it never guesses. It's on a free plan with a limited number of questions per minute, so if you see a rate-limit message, just wait a bit and ask again. Ask about which FMS needs attention, what's causing delays, or anyone's performance."
          hi="Sirf asli, current dashboard data se jawab deta hai — kabhi guess nahi karta. Ye free plan pe hai jisme ek minute mein limited sawaal puchhe ja sakte hain, agar rate-limit ka message aaye to thoda ruk ke dobara pucho. Kaunsi FMS pe dhyan dena hai, delays kyun ho rahe hain, ya kisi ka performance kaisa hai — sab pucho." />
      </div>
    </div>
  );
}
