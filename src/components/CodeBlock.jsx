import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../clipboard.js';

/**
 * Read-only code sample with a working copy button.
 * The button reports success or failure instead of pretending to copy.
 */
export function CodeBlock({ code, label, className = '', dense = false }) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleCopy() {
    const ok = await copyText(code);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2200);
  }

  return (
    <div className={`code-shell ${dense ? 'code-shell-dense' : ''} ${className}`}>
      <div className="code-shell-bar">
        <span className="code-shell-label">{label || 'request'}</span>
        <button type="button" className="code-copy" onClick={handleCopy} aria-label={`Copy ${label || 'code'}`}>
          {state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
          <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
        </button>
      </div>
      <pre className="code-block"><code>{code}</code></pre>
    </div>
  );
}

export default CodeBlock;
