import { useRef } from 'react';
import { LucideIcon, Camera } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  onUploadPhoto?: (file: File) => void;
}

export default function EmptyState({ icon: Icon, title, description, action, onUploadPhoto }: EmptyStateProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (onUploadPhoto && fileRef.current) fileRef.current.click();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadPhoto) onUploadPhoto(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div
      onClick={handleClick}
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 py-16 px-6 text-center transition-colors ${onUploadPhoto ? 'cursor-pointer hover:border-primary hover:bg-primary/5' : ''}`}
    >
      {onUploadPhoto && (
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      )}
      <div className="rounded-full bg-secondary p-4 mb-4">
        {onUploadPhoto ? <Camera size={24} className="text-primary" /> : <Icon size={24} className="text-muted-foreground" />}
      </div>
      <h3 className="text-sm font-medium text-foreground text-mono">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground max-w-sm">{description}</p>
      {onUploadPhoto && <p className="mt-2 text-xs font-medium text-primary">📸 Tap to upload a photo</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
