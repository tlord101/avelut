package com.avelut.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Host activity for the Avelut web app.
 *
 * <p>Why the native inset handling below exists:
 * <ul>
 *   <li>Android 15+ (API 35+) always lays apps out edge-to-edge and this app targets API 36, so the
 *       Capacitor WebView is drawn underneath the status bar.</li>
 *   <li>Capacitor's StatusBar plugin can no longer inset it there: {@code setBackgroundColor} and
 *       {@code setOverlaysWebView} are ignored when targeting API 35+ and
 *       {@code StatusBar.setOverlaysWebView({overlay: false})} is a no-op as well.</li>
 *   <li>Android WebView reports every {@code env(safe-area-inset-*)} value as {@code 0px}, so the web
 *       layer could not reserve that space either - the app header ended up behind the status bar.</li>
 * </ul>
 *
 * <p>What it does: insets the Capacitor bridge container (the CoordinatorLayout that holds the
 * WebView) by the status bar / display-cutout insets and paints the reserved strip, so the status bar
 * sits above the app content again. The strip colour is black, which matches the existing
 * {@code StatusBar} configuration ({@code style: "DARK"} = light icons, {@code backgroundColor:
 * "#000000"}, {@code theme-color} in index.html) and stays correct no matter which in-app theme the
 * user picked.
 *
 * <p>Notes:
 * <ul>
 *   <li>The bottom inset is intentionally left untouched, so the keyboard and the bottom navigation
 *       bar keep behaving exactly as before.</li>
 *   <li>The insets are never consumed, because Capacitor's Keyboard plugin and the WebView still need
 *       the raw values.</li>
 *   <li>The listener is attached to the bridge container instead of {@code android.R.id.content},
 *       because Capacitor's Keyboard plugin already owns the WindowInsets listener of
 *       {@code android.R.id.content} (a View can only have one).</li>
 * </ul>
 */
public class MainActivity extends BridgeActivity {

    /** Colour painted behind the status bar / display cutout strip (light status bar icons). */
    private static final int STATUS_BAR_BACKGROUND_COLOR = Color.BLACK;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        insetWebViewFromSystemBars();
    }

    /**
     * Pushes the WebView (and therefore the whole web app) below the status bar / display cutout.
     */
    private void insetWebViewFromSystemBars() {
        View content = getWindow().getDecorView().findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) {
            return;
        }

        // BridgeActivity#setContentView(capacitor_bridge_layout_main) puts the bridge layout
        // (CoordinatorLayout + CapacitorWebView) at index 0 of the content frame.
        View bridgeContainer = ((ViewGroup) content).getChildAt(0);
        if (bridgeContainer == null) {
            return;
        }

        bridgeContainer.setBackgroundColor(STATUS_BAR_BACKGROUND_COLOR);

        ViewCompat.setOnApplyWindowInsetsListener(bridgeContainer, (view, windowInsets) -> {
            Insets barInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            if (view.getPaddingTop() != barInsets.top
                || view.getPaddingLeft() != barInsets.left
                || view.getPaddingRight() != barInsets.right) {
                view.setPadding(
                    barInsets.left,
                    barInsets.top,
                    barInsets.right,
                    view.getPaddingBottom()
                );
            }

            // Return the insets untouched so the Keyboard plugin and the WebView are unaffected.
            return windowInsets;
        });

        // Make sure the listener runs even if the window already dispatched its insets.
        ViewCompat.requestApplyInsets(bridgeContainer);
    }
}
