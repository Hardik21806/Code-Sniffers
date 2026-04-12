// frontend/src/components/VisualDagBuilder.jsx
import React, { useEffect, useRef, useState } from 'react';

const NODE_WIDTH  = 200;
const NODE_HEIGHT = 70;
const H_GAP       = 80;
const V_GAP       = 40;

const TYPE_COLORS = {
  trigger:      { bg: '#E8C547', text: '#050d1a' },
  action:       { bg: '#00D4AA', text: '#050d1a' },
  notify:       { bg: '#6366f1', text: '#ffffff' },
  utility:      { bg: '#F59E0B', text: '#050d1a' },
  approval_gate:{ bg: '#EF4444', text: '#ffffff' },
};

const STATUS_GLOW = {
  running:   '0 0 18px 4px rgba(99,102,241,0.85)',
  success:   '0 0 18px 4px rgba(0,212,170,0.85)',
  failed:    '0 0 18px 4px rgba(239,68,68,0.85)',
  paused:    '0 0 18px 4px rgba(232,197,71,0.85)',
  skipped:   '0 0 0px 0px transparent',
  pending:   '0 0 0px 0px transparent',
};

const STATUS_BORDER = {
  running:  '#6366f1',
  success:  '#00D4AA',
  failed:   '#EF4444',
  paused:   '#E8C547',
  skipped:  '#4b5563',
  pending:  'rgba(255,255,255,0.12)',
};

const STATUS_ICON = {
  running: '⚡',
  success: '✅',
  failed:  '❌',
  paused:  '🔐',
  skipped: '⏭️',
  pending: '⏳',
};

// ── Layout: assign (x, y) to each node based on dependency levels ──
function layoutDag(nodes) {
  if (!nodes || nodes.length === 0) return {};

  // BFS to assign levels
  const levelMap = {};
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; levelMap[n.id] = 0; });
  nodes.forEach(n => {
    (n.depends_on || []).forEach(dep => {
      if (adj[dep]) adj[dep].push(n.id);
    });
  });

  // Compute max level for each node
  nodes.forEach(n => {
    (n.depends_on || []).forEach(dep => {
      levelMap[n.id] = Math.max(levelMap[n.id], (levelMap[dep] || 0) + 1);
    });
  });

  // Group by level
  const levels = {};
  nodes.forEach(n => {
    const lvl = levelMap[n.id];
    if (!levels[lvl]) levels[lvl] = [];
    levels[lvl].push(n.id);
  });

  // Assign x, y
  const positions = {};
  Object.entries(levels).forEach(([lvl, ids]) => {
    const x = parseInt(lvl) * (NODE_WIDTH + H_GAP) + 40;
    ids.forEach((id, i) => {
      const y = i * (NODE_HEIGHT + V_GAP) + 40;
      positions[id] = { x, y };
    });
  });

  return positions;
}

// ── Arrow between two nodes ──
function Arrow({ from, to, positions }) {
  const fp = positions[from];
  const tp = positions[to];
  if (!fp || !tp) return null;

  const x1 = fp.x + NODE_WIDTH;
  const y1 = fp.y + NODE_HEIGHT / 2;
  const x2 = tp.x;
  const y2 = tp.y + NODE_HEIGHT / 2;
  const cx = (x1 + x2) / 2;

  return (
    <g>
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="rgba(0,212,170,0.6)" />
        </marker>
      </defs>
      <path
        d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
        stroke="rgba(0,212,170,0.45)"
        strokeWidth="2"
        fill="none"
        strokeDasharray="5,4"
        markerEnd="url(#arrow)"
        style={{ transition: 'stroke 0.4s' }}
      />
    </g>
  );
}

// ── Single Node Card ──
function DagNodeCard({ node, position, status, onClick, selected }) {
  const typeStyle = TYPE_COLORS[node.type] || { bg: '#374151', text: '#fff' };
  const borderColor = STATUS_BORDER[status] || STATUS_BORDER.pending;
  const glow        = STATUS_GLOW[status]   || STATUS_GLOW.pending;
  const icon        = STATUS_ICON[status]   || STATUS_ICON.pending;

  return (
    <foreignObject
      x={position.x}
      y={position.y}
      width={NODE_WIDTH}
      height={NODE_HEIGHT}
      style={{ overflow: 'visible', cursor: 'pointer' }}
      onClick={() => onClick(node)}
    >
      <div
        className={status === 'running' ? 'pulse-glow-running float-anim' : (status === 'paused' ? 'pulse-glow-waiting float-anim' : 'float-anim')}
        style={{
          width:        NODE_WIDTH,
          height:       NODE_HEIGHT,
          background:   selected
            ? `linear-gradient(135deg, ${typeStyle.bg}33, ${typeStyle.bg}18)`
            : 'rgba(10,15,30,0.92)',
          border:       `2px solid ${borderColor}`,
          borderRadius: 12,
          boxShadow:    status === 'running' || status === 'paused' ? 'none' : glow,
          padding:      '8px 12px',
          boxSizing:    'border-box',
          display:      'flex',
          flexDirection:'column',
          justifyContent: 'center',
          transition:   'all 0.4s ease',
          userSelect:   'none',
        }}
      >
        {/* Top row: type badge + status icon */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
            background: typeStyle.bg, color: typeStyle.text,
            padding: '2px 7px', borderRadius: 20,
          }}>
            {node.type?.toUpperCase()}
          </span>
          <span style={{ fontSize: 14 }}>{icon}</span>
        </div>

        {/* Node ID */}
        <div style={{
          color: '#ffffff', fontWeight: 700, fontSize: 12,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {node.id}
        </div>

        {/* Tool name */}
        <div style={{
          color: 'rgba(255,255,255,0.4)', fontSize: 10,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {node.mcp_server} → {node.tool}
        </div>
      </div>
    </foreignObject>
  );
}

// ── Main VisualDagBuilder ──
const VisualDagBuilder = ({ dag = [], nodeStatuses = {} }) => {
  const [positions,   setPositions]   = useState({});
  const [selected,    setSelected]    = useState(null);
  const [canvasSize,  setCanvasSize]  = useState({ w: 800, h: 300 });
  const svgRef = useRef(null);

  useEffect(() => {
    if (!dag || dag.length === 0) return;
    const pos = layoutDag(dag);
    setPositions(pos);

    // Auto-size canvas
    const maxX = Math.max(...Object.values(pos).map(p => p.x)) + NODE_WIDTH + 60;
    const maxY = Math.max(...Object.values(pos).map(p => p.y)) + NODE_HEIGHT + 60;
    setCanvasSize({ w: maxX, h: maxY });
  }, [dag]);

  if (!dag || dag.length === 0) {
    return (
      <div style={{
        background:   'rgba(255,255,255,0.03)',
        border:       '1px dashed rgba(255,255,255,0.12)',
        borderRadius: 16,
        padding:      40,
        textAlign:    'center',
        color:        'rgba(255,255,255,0.25)',
        fontSize:     14,
      }}>
        🔗 Plan a workflow above to see the Live DAG here
      </div>
    );
  }

  const selectedNode = dag.find(n => n.id === selected);

  return (
    <div style={{ marginTop: 24 }}>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700 }}>
          🔗 Live Execution DAG
        </span>
        {Object.entries(STATUS_BORDER).map(([s, color]) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{s}</span>
          </span>
        ))}
      </div>

      {/* SVG Canvas */}
      <div style={{
        overflowX:    'auto',
        background:   'rgba(5,13,26,0.95)',
        border:       '1px solid rgba(0,212,170,0.15)',
        borderRadius: 16,
        padding:      12,
      }}>
        <svg
          ref={svgRef}
          width={canvasSize.w}
          height={canvasSize.h}
          style={{ display: 'block', minWidth: '100%' }}
        >
          {/* Draw arrows */}
          {dag.map(node =>
            (node.depends_on || []).map(dep => (
              <Arrow
                key={`${dep}->${node.id}`}
                from={dep}
                to={node.id}
                positions={positions}
              />
            ))
          )}

          {/* Draw nodes */}
          {dag.map(node => {
            const pos    = positions[node.id];
            const status = nodeStatuses[node.id] || 'pending';
            if (!pos) return null;
            return (
              <DagNodeCard
                key={node.id}
                node={node}
                position={pos}
                status={status}
                selected={selected === node.id}
                onClick={n => setSelected(selected === n.id ? null : n.id)}
              />
            );
          })}
        </svg>
      </div>

      {/* Detail panel for selected node */}
      {selectedNode && (
        <div style={{
          marginTop:    12,
          background:   'rgba(255,255,255,0.04)',
          border:       `1px solid ${STATUS_BORDER[nodeStatuses[selectedNode.id]] || 'rgba(255,255,255,0.1)'}`,
          borderRadius: 12,
          padding:      '14px 18px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
              {STATUS_ICON[nodeStatuses[selectedNode.id] || 'pending']} {selectedNode.id}
            </span>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16 }}
            >✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
            <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Type: </span><span style={{ color: '#E8C547' }}>{selectedNode.type}</span></div>
            <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Server: </span><span style={{ color: '#00D4AA' }}>{selectedNode.mcp_server}</span></div>
            <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Tool: </span><span style={{ color: '#fff' }}>{selectedNode.tool}</span></div>
            <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Status: </span><span style={{ color: STATUS_BORDER[nodeStatuses[selectedNode.id]] || '#9ca3af' }}>{nodeStatuses[selectedNode.id] || 'pending'}</span></div>
            <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Approval: </span><span style={{ color: selectedNode.approval_required ? '#EF4444' : '#00D4AA' }}>{selectedNode.approval_required ? 'Required' : 'None'}</span></div>
            <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Max Retries: </span><span style={{ color: '#fff' }}>{selectedNode.max_attempts || 3}</span></div>
          </div>
          {selectedNode.depends_on?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
              Depends on: {selectedNode.depends_on.map(d => (
                <span key={d} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '2px 8px', marginRight: 6, color: '#6366f1' }}>{d}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VisualDagBuilder;