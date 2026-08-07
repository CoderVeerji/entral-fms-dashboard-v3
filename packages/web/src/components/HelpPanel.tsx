import { useHelp } from '../context/HelpContext';

// A small floating card, not a full-screen Drawer — explanations are quick reads, and the point
// of Help mode is exploring the page underneath, so nothing should dim or block it.
export function HelpPanel() {
  const { active, hide, lang, setLang } = useHelp();
  if (!active) return null;

  return (
    <div className="help-panel">
      <div className="help-panel-head">
        <div className="help-panel-title">{active.title}</div>
        <button className="close-x" onClick={hide}><i className="fas fa-xmark" /></button>
      </div>
      <div className="help-panel-body">{lang === 'hi' ? active.hi : active.en}</div>
      <div className="help-lang-toggle">
        <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
        <button className={lang === 'hi' ? 'active' : ''} onClick={() => setLang('hi')}>Hinglish</button>
      </div>
    </div>
  );
}
