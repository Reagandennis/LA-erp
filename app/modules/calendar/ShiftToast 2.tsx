import { useEffect } from 'react';

export function ShiftToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in">
      <span className="font-bold">Shift Active</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-4 text-white/80 hover:text-white font-bold">×</button>
    </div>
  );
}
