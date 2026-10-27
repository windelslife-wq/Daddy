import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Clapperboard, Copy, ExternalLink, FolderKanban, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useLoad } from '../hooks.js';
import { del, get, patch, post, formatDate } from '../api.js';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, ProgressBar, Spinner, StatusBadge, useToast } from '../components/ui.jsx';

export default function Projects() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(null);
  const { data, loading, error, reload } = useLoad(
    () => get(`/api/projects?limit=200${status ? `&status=${encodeURIComponent(status)}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    [status, search],
    { refreshMs: 8000, initial: { projects: [] } },
  );
  const projects = data?.projects || [];

  async function action(id, fn, message) {
    setBusy(id);
    try { await fn(); if (message) showToast(message, 'success'); await reload({ silent: true }); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(null); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.id);
    try {
      await del(`/api/projects/${deleteTarget.id}`);
      showToast('Project deleted.', 'success');
      setDeleteTarget(null);
      await reload({ silent: true });
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Content library"
        title="Projects"
        description="Every generated video, script, subtitle file, provider summary, and publishing attempt in one place."
        actions={<Button to="/app/studio" variant="primary"><Clapperboard size={16} /> New project</Button>}
      />
      <ErrorBanner error={error} onRetry={() => reload().catch(() => {})} />
      <Card>
        <div className="row row-wrap" style={{ marginBottom: 18 }}>
          <div style={{ minWidth: 240, flex: 1 }}><Field label="Search topics"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by topic…" /></Field></div>
          <div style={{ width: 190 }}><Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['queued', 'generating', 'completed', 'failed'].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field></div>
          <Button variant="ghost" onClick={() => reload()}><RefreshCw size={15} /> Refresh</Button>
        </div>
        {loading && !projects.length ? <Spinner label="Loading projects…" /> : projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No matching projects" description="Create a new AI faceless video or adjust your filters." action={<Button to="/app/studio" variant="primary">Open AI Studio</Button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Details</th><th>Created</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td style={{ minWidth: 260 }}>
                      <div className="row">
                        <div className="thumb">{project.hasVideo ? <img src={`/api/media/projects/${project.id}/thumbnail`} alt="" /> : <Clapperboard size={19} />}</div>
                        <div className="truncate"><strong>{project.title}</strong><small className="tiny" style={{ display: 'block' }}>{project.topic}</small></div>
                      </div>
                    </td>
                    <td><StatusBadge status={project.status} />{project.error && <div className="error-text truncate" style={{ maxWidth: 180 }}>{project.error}</div>}</td>
                    <td style={{ minWidth: 150 }}><ProgressBar value={project.progress} compact /><small className="tiny">{project.stage || 'queued'}</small></td>
                    <td><small>{project.niche}<br />{project.config?.style} · {project.durationSeconds || project.config?.duration || 45}s · {project.config?.aspectRatio}</small></td>
                    <td><small>{formatDate(project.createdAt)}</small></td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="xs" variant="ghost" onClick={() => navigate(`/app/projects/${project.id}`)}><ExternalLink size={13} /> Open</Button>
                        {project.status === 'failed' && <Button size="xs" variant="secondary" disabled={busy === project.id} onClick={() => action(project.id, () => post(`/api/projects/${project.id}/regenerate`, {}), 'Generation retry queued.')}><RefreshCw size={13} /> Retry</Button>}
                        <Button size="xs" variant="ghost" title="Duplicate" disabled={busy === project.id} onClick={() => action(project.id, () => post(`/api/projects/${project.id}/duplicate`, {}), 'Project duplicated.')}><Copy size={13} /></Button>
                        <Button size="xs" variant="ghost" title="Archive" disabled={busy === project.id} onClick={() => action(project.id, () => patch(`/api/projects/${project.id}`, { archived: true }), 'Project archived.')}><Archive size={13} /></Button>
                        <Button size="xs" variant="danger" title="Delete" disabled={busy === project.id} onClick={() => setDeleteTarget(project)}><Trash2 size={13} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete project?"
        description="This removes the project, post, and publication records. Published projects cannot be deleted."
        footer={<><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" onClick={confirmDelete} disabled={Boolean(busy)}>{busy ? <Spinner size={15} /> : <Trash2 size={15} />} Delete</Button></>}
      >
        <p>{deleteTarget?.title}</p>
        <div className="banner banner-warning" style={{ margin: 0 }}>Rendered files may remain in server storage until an administrator runs cleanup.</div>
      </Modal>
    </>
  );
}
