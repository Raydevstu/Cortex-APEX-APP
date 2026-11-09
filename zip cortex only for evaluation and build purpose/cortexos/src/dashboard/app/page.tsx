// Step 6: CortexOS Visual Command Center Main Page
import React from 'react';
import { KuzuGraphCanvas } from '../components/KuzuGraphCanvas.js';

export default function CortexCommandCenterPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <header className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">CortexOS Visual Command Center</h1>
          <p className="text-sm text-slate-400">
            Local-First AI Brain • KuzuDB Property Graph • PreToolUse AST Guard • Cross-Platform Sync
          </p>
        </div>
      </header>
      <KuzuGraphCanvas />
    </main>
  );
}
