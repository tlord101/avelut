
import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isConfirming?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isConfirming = false,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-300 px-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white border border-gray-100 rounded-[2.5rem] p-8 md:p-10 shadow-3xl w-full max-w-sm relative animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            
            <h2 className="text-xl font-black text-gray-900 mb-2 tracking-tight">{title}</h2>
            <p className="text-sm font-medium text-gray-400 mb-8 leading-relaxed px-2">{message}</p>
            
            <div className="flex flex-col w-full gap-3">
                <button
                    onClick={onConfirm}
                    disabled={isConfirming}
                    className="w-full py-4 rounded-2xl bg-red-600 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-red-100 hover:bg-red-700 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center"
                >
                    {isConfirming && (
                        <div className="mr-3 w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    )}
                    {confirmText}
                </button>
                <button
                    onClick={onCancel}
                    disabled={isConfirming}
                    className="w-full py-4 rounded-2xl bg-gray-50 text-gray-400 font-black text-xs uppercase tracking-widest hover:text-gray-600 hover:bg-gray-100 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                    {cancelText}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};
