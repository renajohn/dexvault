import React from 'react';
import { createPortal } from 'react-dom';

interface CoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  coverUrl: string;
  title: string;
  artist?: string | string[];
  coverType?: string;
}

const CoverModal = ({ isOpen, onClose, coverUrl, title, artist, coverType }: CoverModalProps) => {
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10200,
    cursor: 'pointer',
    margin: 0,
    padding: 0
  };

  const imageStyle: React.CSSProperties = {
    maxWidth: '90vw',
    maxHeight: '90vh',
    objectFit: 'contain',
    cursor: 'default',
    zIndex: 10201,
    position: 'relative',
    borderRadius: '8px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
  };

  const titleStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'white',
    fontSize: '18px',
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '8px 16px',
    borderRadius: '4px',
    zIndex: 10202,
    pointerEvents: 'none'
  };

  // "Back Cover" said once, not "Back Cover Cover"; none said is the front's.
  const side = !coverType ? 'Cover' : /cover$/i.test(coverType) ? coverType : `${coverType} Cover`;
  const by = Array.isArray(artist) ? artist.join(', ') : artist;
  const modalContent = (
    <div style={overlayStyle} onClick={onClose}>
      <img
        src={coverUrl}
        alt={`${title}, ${side.toLowerCase()}`}
        style={imageStyle}
      />
      <div style={titleStyle}>
        {by ? `${by} - ${title}` : title}
        <br />
        <span style={{ fontSize: '14px', opacity: 0.8 }}>{side}</span>
      </div>
    </div>
  );

  // Use createPortal to render directly to document.body
  return createPortal(modalContent, document.body);
};

export default CoverModal;
