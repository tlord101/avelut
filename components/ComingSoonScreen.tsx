import React from 'react';
import { LogoIcon } from './icons/LogoIcon';

interface ComingSoonScreenProps {
  title: string;
  subtitle: string;
  supportText?: string;
}

export const ComingSoonScreen: React.FC<ComingSoonScreenProps> = ({ title, subtitle, supportText }) => {
  return (
    <div className="min-h-screen overflow-hidden bg-[#07111f] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(132,204,22,0.22),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.18),_transparent_35%),linear-gradient(180deg,_#081120_0%,_#050b14_100%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 overflow-hidden rounded-[36px] border border-white/10 bg-white/5 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
          <div className="flex flex-col justify-between rounded-[28px] bg-[linear-gradient(135deg,_rgba(132,204,22,0.16),_rgba(59,130,246,0.12),_rgba(255,255,255,0.06))] p-6 ring-1 ring-white/10 lg:p-8">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-lime-400/20 bg-lime-400/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-lime-200">
                <LogoIcon className="h-5 w-5 loader-logo" />
                Vantutor
              </div>
              <h1 className="mt-6 max-w-xl text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/72 sm:text-lg">{subtitle}</p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                ['Modern learning', 'A sharper experience is on the way.'],
                ['AI-ready', 'Gemini-powered support will return shortly.'],
                ['Clean rollout', 'Admins can switch the app back on anytime.'],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-[22px] border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-bold text-white">{label}</p>
                  <p className="mt-1 text-xs leading-5 text-white/60">{copy}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[28px] border border-white/10 bg-white/6 p-6 lg:p-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.32em] text-lime-300">Coming soon</p>
              <div className="mt-4 rounded-[28px] border border-white/10 bg-black/20 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-400/15 text-lime-300">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" />
                      <path d="M9 12l2 2 4-5" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Safe rollout mode</p>
                    <p className="text-xs leading-5 text-white/55">The platform is temporarily paused for public access.</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 text-sm text-white/70">
                  <p>• Learning tools, uploads, and Gemini features are currently hidden.</p>
                  <p>• Existing data and admin controls remain available for maintenance.</p>
                  <p>• You can return to the full experience as soon as the admins reopen it.</p>
                </div>
              </div>
            </div>

            {supportText ? (
              <p className="mt-6 text-sm leading-6 text-white/60">{supportText}</p>
            ) : (
              <p className="mt-6 text-sm leading-6 text-white/60">Please check back soon.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
