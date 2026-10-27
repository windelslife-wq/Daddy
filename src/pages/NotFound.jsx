import React from 'react';
import { Compass, Sparkles } from 'lucide-react';
import { Button, Card } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="public-page">
      <Card className="public-card" style={{ textAlign: 'center' }}>
        <div className="brand-mark" style={{ margin: '0 auto 18px' }}><Sparkles size={20} /></div>
        <div className="eyebrow">404</div>
        <h1>This page wandered off-script.</h1>
        <p>The page you requested does not exist, but your studio is still ready.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <Button to="/app" variant="primary"><Compass size={16} /> Go to dashboard</Button>
          <Button to="/app/studio" variant="secondary">Create a video</Button>
        </div>
      </Card>
    </div>
  );
}
