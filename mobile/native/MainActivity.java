package com.hydroloopfarm.manager;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    /** Script injecté uniquement sur l'hôte de l'application : exports (blob) et impression. */
    private static final String JS =
        "(function(){if(window.__hlNative||!window.HydroLoopNative)return;window.__hlNative=true;" +
        "var orig=HTMLAnchorElement.prototype.click;" +
        "HTMLAnchorElement.prototype.click=function(){var a=this;" +
        "if(a.download&&/^blob:/.test(a.href)){fetch(a.href).then(function(r){return r.blob();}).then(function(b){" +
        "var fr=new FileReader();fr.onload=function(){var s=String(fr.result);" +
        "HydroLoopNative.saveFile(a.download,b.type||'application/octet-stream',s.substring(s.indexOf(',')+1));};" +
        "fr.readAsDataURL(b);});return;}return orig.apply(this,arguments);};" +
        "window.print=function(){HydroLoopNative.print(document.title||'HydroLoop');};})();";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final Bridge bridge = getBridge();
        final WebView webView = bridge.getWebView();
        final String serverUrl = bridge.getConfig().getServerUrl();
        final String host = serverUrl == null ? null : Uri.parse(serverUrl).getHost();
        final NativeBridge nativeBridge = new NativeBridge(this, webView);
        webView.addJavascriptInterface(nativeBridge, "HydroLoopNative");

        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            private boolean isTrusted(String url) {
                if (url == null || host == null) return false;
                Uri u = Uri.parse(url);
                return host.equalsIgnoreCase(u.getHost());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                nativeBridge.setTrusted(isTrusted(url));
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                boolean trusted = isTrusted(url);
                nativeBridge.setTrusted(trusted);
                if (trusted) view.evaluateJavascript(JS, null);
            }
        });
    }
}
