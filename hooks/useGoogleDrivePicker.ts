import { useState, useCallback } from 'react';
import { useToast } from './useToast';

interface GoogleDrivePickerOptions {
  clientId: string;
  apiKey: string;
  onFilesSelected: (files: File[]) => void;
}

export const useGoogleDrivePicker = () => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const { addToast } = useToast();

  const openPicker = useCallback(async (options: GoogleDrivePickerOptions) => {
    const { clientId, apiKey, onFilesSelected } = options;

    if (!clientId || !apiKey) {
      addToast("Google Drive credentials not configured in App Settings", "error");
      return;
    }

    setIsPickerLoading(true);

    const buildAndShowPicker = (token: string) => {
      const view = new (window as any).google.picker.DocsView((window as any).google.picker.ViewId.DOCS)
        .setMimeTypes('application/pdf');

      const picker = new (window as any).google.picker.PickerBuilder()
        .enableFeature((window as any).google.picker.Feature.NAV_HIDDEN)
        .enableFeature((window as any).google.picker.Feature.MULTISELECT_ENABLED)
        .setAppId(clientId)
        .setOAuthToken(token)
        .addView(view)
        .setDeveloperKey(apiKey)
        .setCallback(async (data: any) => {
          if (data.action === (window as any).google.picker.Action.PICKED) {
            const docs = data.docs;
            const files: File[] = [];

            addToast(`Importing ${docs.length} file(s) from Drive...`, "info");

            for (const doc of docs) {
              try {
                const fileId = doc.id;
                const fileName = doc.name;
                const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (!response.ok) throw new Error(`Failed to fetch ${fileName}`);
                const blob = await response.blob();
                files.push(new File([blob], fileName, { type: 'application/pdf' }));
              } catch (err) {
                console.error(`Error downloading file from Drive:`, err);
                addToast(`Failed to download ${doc.name}`, "error");
              }
            }
            onFilesSelected(files);
          }
        })
        .build();
      picker.setVisible(true);
      setIsPickerLoading(false);
    };

    const initializePicker = (token: string) => {
      if (!(window as any).google?.picker) {
        // Load the picker library if not already loaded
        (window as any).gapi.load('picker', {
          callback: () => buildAndShowPicker(token)
        });
      } else {
        buildAndShowPicker(token);
      }
    };

    if (accessToken) {
      initializePicker(accessToken);
    } else {
      try {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (response: any) => {
            if (response.access_token) {
              setAccessToken(response.access_token);
              initializePicker(response.access_token);
            } else {
              setIsPickerLoading(false);
              addToast("Failed to acquire Google access token", "error");
            }
          },
          error_callback: (err: any) => {
            console.error('GIS Error:', err);
            setIsPickerLoading(false);
            addToast("Google Auth error", "error");
          }
        });
        client.requestAccessToken();
      } catch (err) {
        console.error('Failed to init GIS client:', err);
        setIsPickerLoading(false);
        addToast("Failed to initialize Google Auth", "error");
      }
    }
  }, [accessToken, addToast]);

  return { openPicker, isPickerLoading };
};
