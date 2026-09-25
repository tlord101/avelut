import { useState, useEffect, useCallback } from 'react';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabaseClient';

export type OTAUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready';

interface OTAState {
    status: OTAUpdateStatus;
    newVersion: string | null;
    downloadProgress: number;
}

// Global shared state across all hook subscribers
let globalState: OTAState = {
    status: 'idle',
    newVersion: null,
    downloadProgress: 0,
};

const listeners = new Set<(state: OTAState) => void>();

function setGlobalState(updater: Partial<OTAState> | ((prev: OTAState) => Partial<OTAState>)) {
    const next = typeof updater === 'function' ? updater(globalState) : updater;
    globalState = { ...globalState, ...next };
    listeners.forEach(l => l(globalState));
}

let isInitialized = false;

/**
 * Splits version strings on dots and dashes to handle semver + timestamp:
 * e.g. "5.9.5-1790295846978" -> [5, 9, 5, 1790295846978]
 */
function parseVersionParts(ver: string): number[] {
    if (!ver) return [0];
    return ver
        .replace(/^v/i, '')
        .split(/[.-]/)
        .map(p => {
            const n = parseInt(p, 10);
            return Number.isNaN(n) ? 0 : n;
        });
}

function isVersionHigher(newVer: string, currentVer: string): boolean {
    if (!currentVer) return true;
    if (newVer === currentVer) return false;

    const n = parseVersionParts(newVer);
    const c = parseVersionParts(currentVer);
    const maxLen = Math.max(n.length, c.length);

    for (let i = 0; i < maxLen; i++) {
        const nPart = n[i] ?? 0;
        const cPart = c[i] ?? 0;
        if (nPart > cPart) return true;
        if (nPart < cPart) return false;
    }
    return false;
}

async function syncInstalledBundleVersion() {
    try {
        const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            const storedCommit = localStorage.getItem('app_bundle_commit');
            if (storedCommit && storedCommit !== data.commit) {
                console.log(`[VersionSync] Bundle updated (${storedCommit} -> ${data.commit}). Active Version: ${data.version}`);
            }
            localStorage.setItem('app_bundle_version', data.version);
            if (data.commit) localStorage.setItem('app_bundle_commit', data.commit);
            if (data.buildTimestamp) localStorage.setItem('app_bundle_build_timestamp', String(data.buildTimestamp));

            const currentOta = localStorage.getItem('current_ota_version');
            if (!currentOta || isVersionHigher(data.version, currentOta)) {
                localStorage.setItem('current_ota_version', data.version);
            }
        }
    } catch {
        // Offline / dev fallback
    }
}

async function checkAndUpdate(data: any) {
    if (!data || !data.version || !data.downloadUrl) return;

    try {
        const currentOtaVersion =
            localStorage.getItem('current_ota_version') ||
            localStorage.getItem('app_bundle_version') ||
            '0.0.0';

        // Check if incoming version is newer than current installed version
        if (isVersionHigher(data.version, currentOtaVersion)) {
            const pendingVersion = localStorage.getItem('pending_ota_version');
            const pendingBundleId = localStorage.getItem('pending_ota_bundle_id');

            // If already downloaded and pending restart
            if (pendingVersion === data.version && (pendingBundleId || !Capacitor.isNativePlatform())) {
                setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
                return;
            }

            console.log('[OTA] Newer update found on Supabase:', data.version, 'Current:', currentOtaVersion);
            setGlobalState({ status: 'downloading', newVersion: data.version, downloadProgress: 10 });

            if (Capacitor.isNativePlatform()) {
                const versionInfo = await CapacitorUpdater.download({
                    url: data.downloadUrl,
                    version: data.version,
                });

                if (versionInfo && versionInfo.id) {
                    localStorage.setItem('pending_ota_bundle_id', versionInfo.id);
                }
                localStorage.setItem('pending_ota_version', data.version);

                console.log('[OTA] Update downloaded & ready in background.');
                setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
            } else {
                // Web simulation: Mark ready so user can test OTA badge
                localStorage.setItem('pending_ota_version', data.version);
                setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
            }
        } else {
            // Already up-to-date
            if (globalState.status !== 'ready') {
                setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });
            }
        }
    } catch (error) {
        console.error('[OTA] Update error:', error);
        setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });
    }
}

async function checkSupabaseOTAUpdate() {
    try {
        const { data, error } = await supabase
            .from('app_kv')
            .select('value')
            .eq('key', 'app_updates/ota_latest')
            .maybeSingle();

        if (error) {
            console.warn('[OTA] Supabase fetch error:', error);
            return;
        }

        if (data?.value) {
            await checkAndUpdate(data.value);
        }
    } catch (e) {
        console.warn('[OTA] Check failed:', e);
    }
}

function initOTAEngine() {
    if (isInitialized) return;
    isInitialized = true;

    void syncInstalledBundleVersion();

    // Check Supabase immediately on boot
    void checkSupabaseOTAUpdate();

    if (Capacitor.isNativePlatform()) {
        try {
            CapacitorUpdater.notifyAppReady().catch(e => console.warn('[OTA] notifyAppReady err:', e));

            // Track actual download progress
            CapacitorUpdater.addListener('download', (info: any) => {
                if (info && typeof info.percent === 'number') {
                    setGlobalState(prev => ({
                        ...prev,
                        status: 'downloading',
                        downloadProgress: Math.min(99, Math.round(info.percent)),
                    }));
                }
            });
        } catch (err) {
            console.warn('[OTA] Native listener registration error:', err);
        }
    }

    // Subscribe to real-time changes on app_kv for OTA updates
    try {
        supabase
            .channel('public:app_kv:ota_update')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'app_kv',
                    filter: 'key=eq.app_updates/ota_latest',
                },
                async (payload: any) => {
                    const val = payload?.new?.value;
                    if (val) {
                        console.log('[OTA] Realtime update detected from Supabase:', val);
                        await checkAndUpdate(val);
                    }
                }
            )
            .subscribe();
    } catch (e) {
        console.warn('[OTA] Realtime subscribe error:', e);
    }

    // Check when window gains focus
    if (typeof window !== 'undefined') {
        window.addEventListener('focus', () => {
            void checkSupabaseOTAUpdate();
        });
    }

    // Check when Capacitor app enters foreground
    import('@capacitor/app')
        .then(({ App }) => {
            App.addListener('appStateChange', async (state) => {
                if (state.isActive) {
                    void checkSupabaseOTAUpdate();
                }
            });
        })
        .catch(() => {});

    // Periodic check every 30 seconds
    setInterval(() => {
        void checkSupabaseOTAUpdate();
    }, 30_000);
}

export function useOTAUpdater() {
    const [state, setState] = useState<OTAState>(globalState);

    useEffect(() => {
        initOTAEngine();
        listeners.add(setState);
        return () => {
            listeners.delete(setState);
        };
    }, []);

    const restartToUpdate = useCallback(async () => {
        try {
            const pendingBundleId = localStorage.getItem('pending_ota_bundle_id');
            const pendingVersion = localStorage.getItem('pending_ota_version');

            if (pendingVersion) {
                localStorage.setItem('current_ota_version', pendingVersion);
            }
            localStorage.removeItem('pending_ota_bundle_id');
            localStorage.removeItem('pending_ota_version');
            setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });

            if (Capacitor.isNativePlatform()) {
                if (pendingBundleId) {
                    await CapacitorUpdater.set({ id: pendingBundleId }).catch(() => {});
                }
                const { App } = await import('@capacitor/app');
                await App.exitApp();
                return;
            }
            window.location.reload();
        } catch (e) {
            console.warn('[OTA] Exit/Reload failed, falling back to window.location.reload():', e);
            window.location.reload();
        }
    }, []);

    return {
        updateStatus: state.status,
        newVersion: state.newVersion,
        downloadProgress: state.downloadProgress,
        restartToUpdate,
    };
}
