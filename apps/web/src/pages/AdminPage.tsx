import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { StressLabView } from '../features/stresslab/StressLabView.js';
import { LabelPrintModal } from '../components/LabelPrintModal.js';

interface AuditItem {
  id: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: any;
}

interface IntegrityCheck {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  rows: any[];
}

interface IntegrityResponse {
  ok: boolean;
  timestamp: string;
  checks: IntegrityCheck[];
}

export const AdminPage: React.FC = () => {
  const { user } = useAuthStore();
  const [mainTab, setMainTab] = useState<'overview' | 'stresslab'>('overview');
  const [activeTab, setActiveTab] = useState<'audit' | 'integrity'>('audit');

  // Audit filter state
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterEntityId, setFilterEntityId] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [page, setPage] = useState(1);
  const [labelModalOpen, setLabelModalOpen] = useState(false);

  // Applied filters (on submit)
  const [appliedFilters, setAppliedFilters] = useState<{
    entity_type?: string;
    entity_id?: string;
    actor_id?: string;
    action?: string;
  }>({});

  const canAuditView = useCan('audit:view');

  const {
    data: auditData,
    isLoading: auditLoading,
    error: auditError
  } = useQuery<{
    items: AuditItem[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ['audit', appliedFilters, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (appliedFilters.entity_type) params.set('entity_type', appliedFilters.entity_type);
      if (appliedFilters.entity_id) params.set('entity_id', appliedFilters.entity_id);
      if (appliedFilters.actor_id) params.set('actor_id', appliedFilters.actor_id);
      if (appliedFilters.action) params.set('action', appliedFilters.action);
      params.set('page', String(page));
      params.set('limit', '25');
      return apiFetch(`/api/audit?${params.toString()}`);
    },
    enabled: activeTab === 'audit' && canAuditView
  });

  const {
    data: integrityData,
    isLoading: integrityLoading,
    isFetching: integrityFetching,
    error: integrityError,
    refetch: refetchIntegrity
  } = useQuery<IntegrityResponse>({
    queryKey: ['admin-integrity'],
    queryFn: () => apiFetch('/api/admin/integrity'),
    enabled: activeTab === 'integrity' && canAuditView
  });

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedFilters({
      entity_type: filterEntityType.trim() || undefined,
      entity_id: filterEntityId.trim() || undefined,
      actor_id: filterActor.trim() || undefined,
      action: filterAction.trim() || undefined
    });
  };

  const handleResetFilters = () => {
    setFilterEntityType('');
    setFilterEntityId('');
    setFilterActor('');
    setFilterAction('');
    setPage(1);
    setAppliedFilters({});
  };

  if (user?.role !== 'MANAGER') {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center', padding: '32px 24px' }}>
        <h2 style={{ color: 'var(--accent-danger)', marginBottom: 8, fontSize: 18 }}>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          System administration features require the <strong>MANAGER</strong> role. You are currently logged in as a <em>{user?.role || 'Guest'}</em>.
        </p>
      </div>
    );
  }

  const totalPages = auditData ? Math.max(1, Math.ceil(auditData.total / auditData.limit)) : 1;

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>System Administration</h1>
          <p className="m3-subtitle">
            Audit logs, database verification, and system integrity status.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setLabelModalOpen(true)}
          data-testid="admin-open-label-studio"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          🏷️ Label Studio
        </button>
      </div>

      {/* Main Tab Navigation */}
      <div className="tabs" role="tablist" aria-label="Admin tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'overview'}
          className={`tab-btn ${mainTab === 'overview' ? 'active' : ''}`}
          onClick={() => setMainTab('overview')}
          data-testid="admin-tab-overview"
        >
          Overview &amp; Logs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'stresslab'}
          className={`tab-btn ${mainTab === 'stresslab' ? 'active' : ''}`}
          onClick={() => setMainTab('stresslab')}
          data-testid="admin-tab-stresslab"
        >
          ⚡ Concurrency &amp; ACID Stress Lab
        </button>
      </div>

      {mainTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="tabs" role="tablist" aria-label="Overview subtabs" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 4 }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'audit'}
              className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
              data-testid="tab-audit"
            >
              Audit Log
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'integrity'}
              className={`tab-btn ${activeTab === 'integrity' ? 'active' : ''}`}
              onClick={() => setActiveTab('integrity')}
              data-testid="tab-integrity"
            >
              Database Integrity
            </button>
          </div>

      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Filters Form */}
          <form
            onSubmit={handleApplyFilters}
            className="m3-toolbar"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) auto',
              gap: 12,
              alignItems: 'flex-end'
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Entity Type</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. order, receipt"
                value={filterEntityType}
                onChange={(e) => setFilterEntityType(e.target.value)}
                data-testid="audit-filter-entity-type"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Entity ID / Ref</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. ORD-0001"
                value={filterEntityId}
                onChange={(e) => setFilterEntityId(e.target.value)}
                data-testid="audit-filter-entity-id"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Actor</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. manager1"
                value={filterActor}
                onChange={(e) => setFilterActor(e.target.value)}
                data-testid="audit-filter-actor"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 12 }}>Action</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. ORDER_PACKED"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                data-testid="audit-filter-action"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" data-testid="audit-filter-submit">
                Filter
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetFilters}
                data-testid="audit-filter-reset"
              >
                Reset
              </button>
            </div>
          </form>

          {/* Audit Table Card */}
          <div className="table-container">
            {auditLoading ? (
              <p style={{ color: 'var(--text-secondary)', padding: '3rem', textAlign: 'center' }}>Loading audit entries...</p>
            ) : auditError ? (
              <p style={{ color: 'var(--accent-danger)', padding: '3rem', textAlign: 'center' }}>Failed to load audit log.</p>
            ) : !auditData || auditData.items.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', padding: '3rem', textAlign: 'center' }}>No audit entries found.</p>
            ) : (
              <>
                <table className="table" data-testid="audit-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Entity Type</th>
                      <th>Entity ID</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditData.items.map((item) => (
                      <tr key={item.id}>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 13 }}>
                          {new Date(item.at).toLocaleString()}
                        </td>
                        <td style={{ fontWeight: 600 }}>{item.actor}</td>
                        <td>
                          <span className="badge badge-info">{item.role}</span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{item.action}</span>
                        </td>
                        <td>{item.entity_type}</td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{item.entity_id}</span>
                        </td>
                        <td style={{ maxWidth: 300 }}>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: 11,
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-color)',
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-xs)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text-secondary)'
                            }}
                            title={JSON.stringify(item.details, null, 2)}
                          >
                            {JSON.stringify(item.details)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderTop: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)'
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }} data-testid="audit-page-info">
                    Page {auditData.page} of {totalPages} ({auditData.total} entries)
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      data-testid="audit-prev-page"
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      data-testid="audit-next-page"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'integrity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            className="card"
            style={{
              padding: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16
            }}
          >
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Warehouse Invariants Verifier</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
                Executes all 13 database integrity checks against warehouse.db read-only.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {integrityData && (
                <span
                  data-testid="integrity-status"
                  className={`badge ${integrityData.ok ? 'badge-ok' : 'badge-danger'}`}
                  style={{ fontSize: 12, padding: '6px 14px' }}
                >
                  {integrityData.ok ? 'PASS: ALL CHECKS PASSING' : 'FAIL: INVARIANTS VIOLATED'}
                </span>
              )}
              <button
                className="btn btn-primary"
                onClick={() => refetchIntegrity()}
                disabled={integrityLoading || integrityFetching}
                data-testid="integrity-run-btn"
              >
                {integrityLoading || integrityFetching ? 'Running...' : 'Run integrity checks'}
              </button>
            </div>
          </div>

          <div className="table-container">
            {integrityLoading ? (
              <p style={{ color: 'var(--text-secondary)', padding: '3rem', textAlign: 'center' }}>Running integrity checks...</p>
            ) : integrityError ? (
              <p style={{ color: 'var(--accent-danger)', padding: '3rem', textAlign: 'center' }}>
                Failed to execute integrity checks: {String(integrityError)}
              </p>
            ) : !integrityData ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                Click "Run integrity checks" to inspect database invariants.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Check ID</th>
                    <th>Rule Description</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th>Offending Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {integrityData.checks.map((check) => (
                    <tr key={check.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {check.id}
                      </td>
                      <td style={{ fontWeight: 500 }}>{check.name}</td>
                      <td>
                        <span
                          data-testid={`integrity-check-${check.id}`}
                          className={`badge ${
                            check.status === 'PASS'
                              ? 'badge-ok'
                              : check.status === 'FAIL'
                              ? 'badge-danger'
                              : 'badge-warning'
                          }`}
                        >
                          {check.status}
                        </span>
                      </td>
                      <td>
                        {check.rows && check.rows.length > 0 ? (
                          <pre
                            data-testid={`integrity-rows-${check.id}`}
                            style={{
                              margin: 0,
                              fontSize: 11,
                              color: 'var(--accent-danger)',
                              background: 'rgba(239, 68, 68, 0.14)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-xs)',
                              maxHeight: 120,
                              overflow: 'auto'
                            }}
                          >
                            {JSON.stringify(check.rows, null, 2)}
                          </pre>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
        </div>
      )}

      {/* Main Tab: Concurrency & ACID Stress Lab */}
      {mainTab === 'stresslab' && <StressLabView />}

      {/* Label Print Modal */}
      <LabelPrintModal
        isOpen={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        initialTab="bin"
      />
    </div>
  );
};
