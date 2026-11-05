package com.hydroloopfarm.manager;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Pont natif minimal et restreint à l'hôte de l'application : enregistrer un export, imprimer la page. */
public class NativeBridge {
    private static final int MAX_BASE64_CHARS = 70 * 1024 * 1024; // ~50 Mo de données

    private final Activity activity;
    private final WebView webView;
    private volatile boolean trusted = false;

    NativeBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    void setTrusted(boolean value) {
        this.trusted = value;
    }

    private void toast(final String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }

    /** Nom de fichier sûr : pas de chemin, caractères limités. */
    static String safeName(String name) {
        String base = name == null ? "" : name.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        if (base.isEmpty() || base.startsWith(".")) base = "hydroloop-export" + base;
        return base.length() > 100 ? base.substring(base.length() - 100) : base;
    }

    @JavascriptInterface
    public void saveFile(String name, String mime, String base64) {
        if (!trusted || base64 == null || base64.length() > MAX_BASE64_CHARS) {
            toast("Enregistrement refusé.");
            return;
        }
        final String fileName = safeName(name);
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            String where;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = activity.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("MediaStore indisponible");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("Flux indisponible");
                    out.write(data);
                }
                where = "Téléchargements";
            } else {
                // API 26-28 : dossier propre à l'application (aucune permission de stockage requise)
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) throw new IllegalStateException("Stockage indisponible");
                File file = new File(dir, fileName);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(data);
                }
                where = file.getParent();
            }
            toast("Fichier enregistré (" + where + ") : " + fileName);
        } catch (Exception e) {
            toast("Échec de l'enregistrement : " + e.getMessage());
        }
    }

    @JavascriptInterface
    public void print(final String title) {
        if (!trusted) return;
        activity.runOnUiThread(() -> {
            PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
            if (pm == null) return;
            String job = title == null || title.isEmpty() ? "HydroLoop" : title;
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(job);
            pm.print(job, adapter, new PrintAttributes.Builder().build());
        });
    }
}
