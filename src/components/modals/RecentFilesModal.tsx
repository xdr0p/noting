import { memo } from 'react';

interface RecentFilesModalProps {
  isOpen: boolean;
  recentFiles: string[];
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

export const RecentFilesModal = memo(function RecentFilesModal({
  isOpen,
  recentFiles,
  onOpenFile,
  onClose,
}: RecentFilesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3>Recent Files</h3>
        {recentFiles.length === 0 ? (
          <p>No recent files yet.</p>
        ) : (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '8px', 
            marginBottom: '24px', 
            maxHeight: '250px', 
            overflowY: 'auto', 
            textAlign: 'left' 
          }}>
            {recentFiles.map(path => (
              <button
                key={path}
                style={{ 
                  background: 'rgba(255,255,255,0.03)', 
                  border: '1px solid rgba(255,255,255,0.05)', 
                  color: '#d1d1d6', 
                  padding: '10px', 
                  borderRadius: '6px', 
                  cursor: 'pointer', 
                  textAlign: 'left', 
                  wordBreak: 'break-all', 
                  fontSize: '0.85rem' 
                }}
                onClick={() => onOpenFile(path)}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                <strong style={{ display: 'block', color: '#ffffff', marginBottom: '2px' }}>
                  {path.split(/[/\\]/).pop()}
                </strong>
                <span style={{ color: '#8b8ba3', fontSize: '0.75rem' }}>{path}</span>
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="modal-btn neutral" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
});
