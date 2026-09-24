import { db, get, onValue, ref as dbRef } from '@/lib/backend';
import { useState, useEffect, useCallback } from 'react';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Capacitor } from '@capacitor/core';

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

function parseVersionParts(ver: string): number[] {
    return ver.replace(/^v/i, '').split('.').map(p => parseInt(p, 10) || 0);
}

function isVersionHigher(newVer: string, currentVer: string): boolean {
    if (!currentVer) return true;
    const n = parseVersionParts(newVer);
    const c = parseVersionParts(currentVer);
    const maxLen = Math.max(n.length, c.length);
    for (let i = 0; i < maxLen; i++) {
        const nPart = n[i] || 0;
        const cPart = c[i] || 0;
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
            localStorage.setItem('app_bundle_commit', data.commit);
            localStorage.setItem('app_bundle_build_timestamp', String(data.buildTimestamp));

            const currentOta = localStorage.getItem('current_ota_version');
            if (!currentOta || isVersionHigher(data.version, currentOta)) {
                localStorage.setItem('current_ota_version', data.version);
            }
        }
    } catch {
        // Offline / dev fallback
    }
}

function initOTAEngine() {
    if (isInitialized) return;
    isInitialized = true;

    void syncInstalledBundleVersion();

    if (!Capacitor.isNativePlatform()) return;

    import('@capacitor/app').then(({ App }) => {
        // Notify Capgo that the app successfully booted
        CapacitorUpdater.notifyAppReady().catch(e => console.warn('[OTA] notifyAppReady err:', e));

        const checkAndUpdate = async (data: any) => {
            if (!data || !data.version || !data.downloadUrl) return;

            try {
                const currentOtaVersion = localStorage.getItem('current_ota_version') || localStorage.getItem('app_bundle_version') || '0.0.0';

                // Only download/install if database version is strictly higher than currently installed OTA version
                if (isVersionHigher(data.version, currentOtaVersion)) {
                    // Check if already downloaded pending version
                    const pendingVersion = localStorage.getItem('pending_ota_version');
                    const pendingBundleId = localStorage.getItem('pending_ota_bundle_id');

                    if (pendingVersion === data.version && pendingBundleId) {
                        setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
                        return;
                    }

                    console.log('[OTA] New higher update found. Starting background download:', data.version, 'Current:', currentOtaVersion);
                    setGlobalState({ status: 'downloading', newVersion: data.version, downloadProgress: 0 });

                    const versionInfo = await CapacitorUpdater.download({
                        url: data.downloadUrl,
                        version: data.version,
                    });

                    localStorage.setItem('pending_ota_bundle_id', versionInfo.id);
                    localStorage.setItem('pending_ota_version', data.version);

                    console.log('[OTA] Update downloaded & ready in background.');
                    setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
                } else {
                    setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });
                }
            } catch (error) {
                console.error('[OTA] Update error:', error);
                setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });
            }
        };

        const otaRef = dbRef(db, 'app_updates/ota_latest');

        // Listen for real-time DB changes
        onValue(otaRef, (snapshot) => checkAndUpdate(snapshot.val()));

        // Also check whenever app enters foreground
        App.addListener('appStateChange', async (state) => {
            if (state.isActive) {
                get(otaRef).then(snapshot => checkAndUpdate(snapshot.val())).catch(() => {});
            }
        });
    }).catch(e => console.warn('[OTA] Init error:', e));
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
