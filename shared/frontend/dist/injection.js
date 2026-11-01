"use strict";
/* Yood's intentionally small YouTube integration layer. It is installed once
 * by Tauri as an initialization script and survives YouTube's SPA navigation. */
// The injected layer is still page JavaScript, so do not expose an
// unrestricted Tauri command bridge.  This is not a substitute for Tauri's
// capability ACL, but it prevents a random YouTube script from invoking
// arbitrary native commands through the convenience object.
const ALLOWED_INVOKE_COMMANDS = new Set([
    "get_system_appearance", "get_settings", "get_settings_for_ui", "get_app_info", "get_account_hints",
    "get_desktop_environment", "tracking_protection_enabled", "check_filter_request",
    "get_filter_script_rules", "inspect_url", "enqueue_download", "list_downloads",
    "pause_download", "resume_download", "cancel_download", "retry_download",
    "remove_download", "open_download", "open_download_folder", "open_native_player",
    "open_native_player_url", "open_external", "pick_folder", "resolve_media_path", "update_settings",
    "update_filter_lists", "update_ytdlp", "set_account_hints", "clear_account_hints",
    "plugin:event|listen", "plugin:event|unlisten",
]);
const PRIVILEGED_INVOKE_COMMANDS = new Set([
    "open_download", "open_download_folder", "open_native_player", "open_native_player_url",
    "open_external", "pick_folder", "resolve_media_path", "update_settings", "update_filter_lists", "update_ytdlp",
    "get_account_hints", "set_account_hints", "clear_account_hints",
]);
function isSupportedYoutubeHost(hostname) {
    const host = hostname.toLowerCase();
    if (host === "accounts.youtube.com" || host.endsWith(".accounts.youtube.com"))
        return false;
    return host === "youtube.com" || host.endsWith(".youtube.com") ||
        host === "youtu.be" || host.endsWith(".youtu.be") ||
        host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
}
const isYoodPage = isSupportedYoutubeHost(location.hostname);
function hasUserActivation() {
    const activation = navigator.userActivation;
    return activation?.isActive !== false;
}
// Capture Tauri IPC before the page can call it. The bridge is deliberately
// the only path used by Yood's integration layer; the raw helper is shadowed
// when the WebView allows it, so a YouTube script cannot invoke arbitrary
// native commands by reaching into the global Tauri object.
const capturedNativeInvoke = isYoodPage
    ? window.__TAURI_INTERNALS__?.invoke?.bind(window.__TAURI_INTERNALS__)
    : undefined;
if (capturedNativeInvoke) {
    try {
        Object.defineProperty(window.__TAURI_INTERNALS__, "invoke", {
            value: undefined,
            configurable: true,
        });
    }
    catch {
        // Some WebView builds make the internal property non-configurable; the
        // command allow-list below still protects the convenience bridge.
    }
}
const invoke = async (command, args) => {
    if (!ALLOWED_INVOKE_COMMANDS.has(command))
        throw new Error("Yood command is not allowed");
    if (PRIVILEGED_INVOKE_COMMANDS.has(command) && !hasUserActivation()) {
        throw new Error("Yood command requires an explicit user action");
    }
    const fn = window.__YOOD_NATIVE__?.invoke
        ?? capturedNativeInvoke
        ?? window.__TAURI_INTERNALS__?.invoke
        ?? window.__TAURI__?.core?.invoke;
    if (!fn)
        throw new Error("Yood integration is not available");
    return fn(command, args);
};
// Returns a no-op unlisten function when the Tauri event bridge is
// unavailable so callers never need to null-check the result.
async function listenEvent(event, callback) {
    const listen = window.__TAURI__?.event?.listen;
    if (listen) {
        try {
            return await listen(event, callback);
        }
        catch {
            return () => undefined;
        }
    }
    const internals = window.__TAURI_INTERNALS__;
    const invoke = window.__YOOD_NATIVE__?.invoke ?? capturedNativeInvoke ?? internals?.invoke;
    const transform = internals?.transformCallback;
    if (!invoke || !transform)
        return () => undefined;
    let callbackId;
    try {
        callbackId = transform((value) => callback(value));
        const eventId = await invoke("plugin:event|listen", {
            event,
            target: { kind: "Any" },
            handler: callbackId,
        });
        return async () => {
            try {
                await invoke("plugin:event|unlisten", { event, eventId });
            }
            catch { /* best effort during teardown */ }
            if (callbackId !== undefined)
                internals?.unregisterCallback?.(callbackId);
        };
    }
    catch {
        if (callbackId !== undefined)
            internals?.unregisterCallback?.(callbackId);
        return () => undefined;
    }
}
let selectedAppearance = "system";
let systemAppearance;
let detectedSystemAppearance;
let appearanceRevision = 0;
let appearanceTimers = [];
let downloadShortcut = "d";
const YOOD_I18N = { "en": { "download": "Download", "downloadWith": "Download with Yood", "watchLater": "Watch later", "saved": "✓ Saved", "savedTo": "Saved to Watch later", "removedFrom": "Removed from Watch later", "alreadyIn": "Already in Watch later", "downloadAll": "Download all", "clear": "Clear", "empty": "No videos saved yet", "sent": "Sent to Yood — downloading in the background", "cancel": "Cancel", "playlistTitle": "Download entire playlist", "playlistConfirm": "This will download all {n} videos in this playlist.", "browse": "Browse…", "back": "Back", "forward": "Forward", "close": "Close", "browseFailed": "Could not open folder picker", "saveToFolder": "Save to", "defaultFolder": "Default folder" }, "he": { "download": "הורדה", "downloadWith": "הורד בעזרת Yood", "watchLater": "צפייה מאוחרת", "saved": "✓ נשמר", "savedTo": "נשמר לצפייה מאוחרת", "removedFrom": "הוסר מהצפייה המאוחרת", "alreadyIn": "כבר נמצא בצפייה מאוחרת", "downloadAll": "הורד הכל", "clear": "נקה", "empty": "עדיין לא נשמרו סרטונים", "sent": "נשלח ל-Yood — מוריד ברקע", "cancel": "ביטול", "playlistTitle": "הורדת הפלייליסט כולו", "playlistConfirm": "פעולה זו תוריד את כל {n} הסרטונים בפלייליסט.", "browse": "עיון…", "back": "חזרה", "forward": "קדימה", "close": "סגירה", "browseFailed": "לא ניתן לפתוח את בורר התיקיות", "saveToFolder": "שמירה לתיקייה", "defaultFolder": "תיקיית ברירת מחדל" }, "iw": { "download": "הורדה", "downloadWith": "הורד בעזרת Yood", "watchLater": "צפייה מאוחרת", "saved": "✓ נשמר", "savedTo": "נשמר לצפייה מאוחרת", "removedFrom": "הוסר מהצפייה המאוחרת", "alreadyIn": "כבר נמצא בצפייה מאוחרת", "downloadAll": "הורד הכל", "clear": "נקה", "empty": "עדיין לא נשמרו סרטונים", "sent": "נשלח ל-Yood — מוריד ברקע", "cancel": "ביטול", "playlistTitle": "הורדת הפלייליסט כולו", "playlistConfirm": "פעולה זו תוריד את כל {n} הסרטונים בפלייליסט.", "browse": "עיון…", "back": "חזרה", "forward": "קדימה", "close": "סגירה", "browseFailed": "לא ניתן לפתוח את בורר התיקיות", "saveToFolder": "שמירה לתיקייה", "defaultFolder": "תיקיית ברירת מחדל" }, "ar": { "download": "تنزيل", "downloadWith": "تنزيل مع Yood", "watchLater": "المشاهدة لاحقاً", "saved": "✓ تم الحفظ", "savedTo": "تم الحفظ للمشاهدة لاحقاً", "removedFrom": "تمت الإزالة من المشاهدة لاحقاً", "alreadyIn": "موجود بالفعل في المشاهدة لاحقاً", "downloadAll": "تنزيل الكل", "clear": "مسح", "empty": "لا توجد مقاطع محفوظة بعد", "sent": "تم الإرسال إلى Yood — جارٍ التنزيل في الخلفية", "cancel": "إلغاء", "playlistTitle": "تنزيل قائمة التشغيل كاملة", "playlistConfirm": "سيؤدي هذا إلى تنزيل جميع مقاطع الفيديو الـ {n} في قائمة التشغيل.", "browse": "استعراض…", "back": "رجوع", "forward": "تقديم", "close": "إغلاق", "browseFailed": "تعذر فتح منتقي المجلدات", "saveToFolder": "حفظ في", "defaultFolder": "المجلد الافتراضي" }, "es": { "download": "Descargar", "downloadWith": "Descargar con Yood", "watchLater": "Ver más tarde", "saved": "✓ Guardado", "savedTo": "Guardado para ver más tarde", "removedFrom": "Eliminado de Ver más tarde", "alreadyIn": "Ya está en Ver más tarde", "downloadAll": "Descargar todo", "clear": "Borrar", "empty": "Aún no hay vídeos guardados", "sent": "Enviado a Yood — descargando en segundo plano", "cancel": "Cancelar", "playlistTitle": "Descargar la playlist completa", "playlistConfirm": "Esto descargará los {n} vídeos de la playlist.", "browse": "Examinar…", "back": "Atrás", "forward": "Adelante", "close": "Cerrar", "browseFailed": "No se pudo abrir el selector de carpetas", "saveToFolder": "Guardar en", "defaultFolder": "Carpeta predeterminada" }, "fr": { "download": "Télécharger", "downloadWith": "Télécharger avec Yood", "watchLater": "À regarder plus tard", "saved": "✓ Enregistré", "savedTo": "Enregistré à regarder plus tard", "removedFrom": "Retiré de À regarder plus tard", "alreadyIn": "Déjà dans À regarder plus tard", "downloadAll": "Tout télécharger", "clear": "Effacer", "empty": "Aucune vidéo enregistrée", "sent": "Envoyé à Yood — téléchargement en arrière-plan", "cancel": "Annuler", "playlistTitle": "Télécharger toute la playlist", "playlistConfirm": "Cela téléchargera les {n} vidéos de la playlist.", "browse": "Parcourir…", "back": "Retour", "forward": "Suivant", "close": "Fermer", "browseFailed": "Impossible d'ouvrir le sélecteur de dossier", "saveToFolder": "Enregistrer dans", "defaultFolder": "Dossier par défaut" }, "de": { "download": "Herunterladen", "downloadWith": "Mit Yood herunterladen", "watchLater": "Später ansehen", "saved": "✓ Gespeichert", "savedTo": "Für Später ansehen gespeichert", "removedFrom": "Aus Später ansehen entfernt", "alreadyIn": "Bereits in Später ansehen", "downloadAll": "Alle herunterladen", "clear": "Löschen", "empty": "Noch keine Videos gespeichert", "sent": "An Yood gesendet — lädt im Hintergrund", "cancel": "Abbrechen", "playlistTitle": "Gesamte Playlist herunterladen", "playlistConfirm": "Dadurch werden alle {n} Videos dieser Playlist heruntergeladen.", "browse": "Durchsuchen…", "back": "Zurück", "forward": "Weiter", "close": "Schließen", "browseFailed": "Ordnerauswahl konnte nicht geöffnet werden", "saveToFolder": "Speichern in", "defaultFolder": "Standardordner" }, "ru": { "download": "Скачать", "downloadWith": "Скачать с Yood", "watchLater": "Смотреть позже", "saved": "✓ Сохранено", "savedTo": "Сохранено в «Смотреть позже»", "removedFrom": "Удалено из «Смотреть позже»", "alreadyIn": "Уже в «Смотреть позже»", "downloadAll": "Скачать все", "clear": "Очистить", "empty": "Пока ничего не сохранено", "sent": "Отправлено в Yood — загрузка в фоне", "cancel": "Отмена", "playlistTitle": "Скачать весь плейлист", "playlistConfirm": "Будут скачаны все {n} видео из этого плейлиста.", "browse": "Обзор…", "back": "Назад", "forward": "Вперёд", "close": "Закрыть", "browseFailed": "Не удалось открыть выбор папки", "saveToFolder": "Сохранить в", "defaultFolder": "Папка по умолчанию" }, "uk": { "download": "Завантажити", "downloadWith": "Завантажити з Yood", "watchLater": "Дивитися пізніше", "saved": "✓ Збережено", "savedTo": "Збережено в «Дивитися пізніше»", "removedFrom": "Вилучено з «Дивитися пізніше»", "alreadyIn": "Уже в «Дивитися пізніше»", "downloadAll": "Завантажити все", "clear": "Очистити", "empty": "Поки нічого не збережено", "sent": "Надіслано в Yood — завантаження у фоні", "cancel": "Скасувати", "playlistTitle": "Завантажити весь плейлист", "playlistConfirm": "Буде завантажено всі {n} відео з цього плейлиста.", "browse": "Огляд…", "back": "Назад", "forward": "Уперед", "close": "Закрити", "browseFailed": "Не вдалося відкрити вибір папки", "saveToFolder": "Зберегти в", "defaultFolder": "Типова папка" }, "pt": { "download": "Baixar", "downloadWith": "Baixar com Yood", "watchLater": "Ver mais tarde", "saved": "✓ Salvo", "savedTo": "Salvo em Ver mais tarde", "removedFrom": "Removido de Ver mais tarde", "alreadyIn": "Já está em Ver mais tarde", "downloadAll": "Baixar tudo", "clear": "Limpar", "empty": "Nenhum vídeo salvo ainda", "sent": "Enviado para o Yood — baixando em segundo plano", "cancel": "Cancelar", "playlistTitle": "Baixar a playlist inteira", "playlistConfirm": "Isto baixará todos os {n} vídeos desta playlist.", "browse": "Procurar…", "back": "Voltar", "forward": "Avançar", "close": "Fechar", "browseFailed": "Não foi possível abrir o seletor de pastas", "saveToFolder": "Salvar em", "defaultFolder": "Pasta padrão" }, "it": { "download": "Scarica", "downloadWith": "Scarica con Yood", "watchLater": "Guarda dopo", "saved": "✓ Salvato", "savedTo": "Salvato in Guarda dopo", "removedFrom": "Rimosso da Guarda dopo", "alreadyIn": "Già in Guarda dopo", "downloadAll": "Scarica tutto", "clear": "Cancella", "empty": "Nessun video salvato", "sent": "Inviato a Yood — download in background", "cancel": "Annulla", "playlistTitle": "Scarica l'intera playlist", "playlistConfirm": "Verranno scaricati tutti i {n} video di questa playlist.", "browse": "Sfoglia…", "back": "Indietro", "forward": "Avanti", "close": "Chiudi", "browseFailed": "Impossibile aprire il selettore cartelle", "saveToFolder": "Salva in", "defaultFolder": "Cartella predefinita" }, "nl": { "download": "Downloaden", "downloadWith": "Downloaden met Yood", "watchLater": "Later bekijken", "saved": "✓ Opgeslagen", "savedTo": "Opgeslagen voor Later bekijken", "removedFrom": "Verwijderd uit Later bekijken", "alreadyIn": "Staat al in Later bekijken", "downloadAll": "Alles downloaden", "clear": "Wissen", "empty": "Nog geen video's opgeslagen", "sent": "Naar Yood gestuurd — downloadt op de achtergrond", "cancel": "Annuleren", "playlistTitle": "Volledige afspeellijst downloaden", "playlistConfirm": "Hiermee worden alle {n} video's in deze afspeellijst gedownload.", "browse": "Bladeren…", "back": "Terug", "forward": "Vooruit", "close": "Sluiten", "browseFailed": "Kon mappenkiezer niet openen", "saveToFolder": "Opslaan in", "defaultFolder": "Standaardmap" }, "pl": { "download": "Pobierz", "downloadWith": "Pobierz z Yood", "watchLater": "Obejrzyj później", "saved": "✓ Zapisano", "savedTo": "Zapisano do Obejrzyj później", "removedFrom": "Usunięto z Obejrzyj później", "alreadyIn": "Już jest w Obejrzyj później", "downloadAll": "Pobierz wszystko", "clear": "Wyczyść", "empty": "Brak zapisanych filmów", "sent": "Wysłano do Yood — pobieranie w tle", "cancel": "Anuluj", "playlistTitle": "Pobierz całą playlistę", "playlistConfirm": "Spowoduje to pobranie wszystkich {n} filmów z tej playlisty.", "browse": "Przeglądaj…", "back": "Wstecz", "forward": "Dalej", "close": "Zamknij", "browseFailed": "Nie można otworzyć wyboru folderu", "saveToFolder": "Zapisz w", "defaultFolder": "Domyślny folder" }, "tr": { "download": "İndir", "downloadWith": "Yood ile indir", "watchLater": "Daha sonra izle", "saved": "✓ Kaydedildi", "savedTo": "Daha sonra izle listesine kaydedildi", "removedFrom": "Daha sonra izle listesinden çıkarıldı", "alreadyIn": "Zaten Daha sonra izle'de", "downloadAll": "Tümünü indir", "clear": "Temizle", "empty": "Henüz kaydedilen video yok", "sent": "Yood'a gönderildi — arka planda indiriliyor", "cancel": "İptal", "playlistTitle": "Çalma listesinin tamamını indir", "playlistConfirm": "Bu listedeki {n} videonun tamamı indirilecek.", "browse": "Gözat…", "back": "Geri", "forward": "İleri", "close": "Kapat", "browseFailed": "Klasör seçici açılamadı", "saveToFolder": "Şuraya kaydet", "defaultFolder": "Varsayılan klasör" }, "hi": { "download": "डाउनलोड", "downloadWith": "Yood के साथ डाउनलोड", "watchLater": "बाद में देखें", "saved": "✓ सहेजा गया", "savedTo": "बाद में देखने के लिए सहेजा गया", "removedFrom": "बाद में देखने से हटाया गया", "alreadyIn": "पहले से बाद में देखने में है", "downloadAll": "सभी डाउनलोड करें", "clear": "साफ़ करें", "empty": "अभी कोई वीडियो सहेजा नहीं गया", "sent": "Yood को भेजा गया — बैकग्राउंड में डाउनलोड हो रहा है", "cancel": "रद्द करें", "playlistTitle": "पूरी प्लेलिस्ट डाउनलोड करें", "playlistConfirm": "इससे इस प्लेलिस्ट के सभी {n} वीडियो डाउनलोड होंगे।", "browse": "ब्राउज़ करें…", "back": "पीछे", "forward": "आगे", "close": "बंद करें", "browseFailed": "फ़ोल्डर चयनकर्ता नहीं खोला जा सका", "saveToFolder": "इसमें सहेजें", "defaultFolder": "डिफ़ॉल्ट फ़ोल्डर" }, "ja": { "download": "ダウンロード", "downloadWith": "Yoodでダウンロード", "watchLater": "後で見る", "saved": "✓ 保存済み", "savedTo": "「後で見る」に保存しました", "removedFrom": "「後で見る」から削除しました", "alreadyIn": "既に「後で見る」にあります", "downloadAll": "すべてダウンロード", "clear": "クリア", "empty": "保存された動画はまだありません", "sent": "Yoodに送信しました — バックグラウンドでダウンロード中", "cancel": "キャンセル", "playlistTitle": "プレイリスト全体をダウンロード", "playlistConfirm": "このプレイリストの{n}本の動画すべてをダウンロードします。", "browse": "参照…", "back": "戻る", "forward": "進む", "close": "閉じる", "browseFailed": "フォルダ選択を開けませんでした", "saveToFolder": "保存先", "defaultFolder": "既定のフォルダ" }, "ko": { "download": "다운로드", "downloadWith": "Yood로 다운로드", "watchLater": "나중에 볼 동영상", "saved": "✓ 저장됨", "savedTo": "나중에 볼 동영상에 저장됨", "removedFrom": "나중에 볼 동영상에서 삭제됨", "alreadyIn": "이미 나중에 볼 동영상에 있음", "downloadAll": "모두 다운로드", "clear": "지우기", "empty": "저장된 동영상이 없습니다", "sent": "Yood로 전송됨 — 백그라운드에서 다운로드 중", "cancel": "취소", "playlistTitle": "재생목록 전체 다운로드", "playlistConfirm": "이 재생목록의 동영상 {n}개를 모두 다운로드합니다.", "browse": "찾아보기…", "back": "뒤로", "forward": "앞으로", "close": "닫기", "browseFailed": "폴더 선택기를 열 수 없습니다", "saveToFolder": "저장 위치", "defaultFolder": "기본 폴더" }, "zh": { "download": "下载", "downloadWith": "用 Yood 下载", "watchLater": "稍后观看", "saved": "✓ 已保存", "savedTo": "已保存到稍后观看", "removedFrom": "已从稍后观看中移除", "alreadyIn": "已在稍后观看中", "downloadAll": "下载全部", "clear": "清空", "empty": "还没有保存的视频", "sent": "已发送到 Yood — 正在后台下载", "cancel": "取消", "playlistTitle": "下载整个播放列表", "playlistConfirm": "这将下载此播放列表中的全部 {n} 个视频。", "browse": "浏览…", "back": "返回", "forward": "前进", "close": "关闭", "browseFailed": "无法打开文件夹选择器", "saveToFolder": "保存到", "defaultFolder": "默认文件夹" }, "zh-cn": { "download": "下载", "downloadWith": "用 Yood 下载", "watchLater": "稍后观看", "saved": "✓ 已保存", "savedTo": "已保存到稍后观看", "removedFrom": "已从稍后观看中移除", "alreadyIn": "已在稍后观看中", "downloadAll": "下载全部", "clear": "清空", "empty": "还没有保存的视频", "sent": "已发送到 Yood — 正在后台下载", "cancel": "取消", "playlistTitle": "下载整个播放列表", "playlistConfirm": "这将下载此播放列表中的全部 {n} 个视频。", "browse": "浏览…", "back": "返回", "forward": "前进", "close": "关闭", "browseFailed": "无法打开文件夹选择器", "saveToFolder": "保存到", "defaultFolder": "默认文件夹" }, "zh-tw": { "download": "下載", "downloadWith": "用 Yood 下載", "watchLater": "稍後觀看", "saved": "✓ 已儲存", "savedTo": "已儲存到稍後觀看", "removedFrom": "已從稍後觀看中移除", "alreadyIn": "已在稍後觀看中", "downloadAll": "下載全部", "clear": "清除", "empty": "尚未儲存影片", "sent": "已傳送到 Yood — 正在背景下載", "cancel": "取消", "playlistTitle": "下載整個播放清單", "playlistConfirm": "這將下載此播放清單中的全部 {n} 部影片。", "browse": "瀏覽…", "back": "返回", "forward": "前進", "close": "關閉", "browseFailed": "無法開啟資料夾選擇器", "saveToFolder": "儲存至", "defaultFolder": "預設資料夾" }, "zh-hk": { "download": "下載", "downloadWith": "用 Yood 下載", "watchLater": "稍後觀看", "saved": "✓ 已儲存", "savedTo": "已儲存到稍後觀看", "removedFrom": "已從稍後觀看中移除", "alreadyIn": "已在稍後觀看中", "downloadAll": "下載全部", "clear": "清除", "empty": "尚未儲存影片", "sent": "已傳送到 Yood — 正在背景下載", "cancel": "取消", "playlistTitle": "下載整個播放清單", "playlistConfirm": "這將下載此播放清單中的全部 {n} 部影片。", "browse": "瀏覽…", "back": "返回", "forward": "前進", "close": "關閉", "browseFailed": "無法開啟資料夾選擇器", "saveToFolder": "儲存至", "defaultFolder": "預設資料夾" }, "fa": { "download": "دانلود", "downloadWith": "دانلود با Yood", "watchLater": "تماشا بعداً", "saved": "✓ ذخیره شد", "savedTo": "در تماشا بعداً ذخیره شد", "removedFrom": "از تماشا بعداً حذف شد", "alreadyIn": "قبلاً در تماشا بعداً هست", "downloadAll": "دانلود همه", "clear": "پاک کردن", "empty": "هنوز ویدیویی ذخیره نشده", "sent": "به Yood ارسال شد — در پس‌زمینه دانلود می‌شود", "cancel": "لغو", "playlistTitle": "دانلود کل لیست پخش", "playlistConfirm": "این کار هر {n} ویدیوی این لیست پخش را دانلود می‌کند.", "browse": "مرور…", "back": "قبلی", "forward": "بعدی", "close": "بستن", "browseFailed": "امکان باز کردن انتخابگر پوشه وجود ندارد", "saveToFolder": "ذخیره در", "defaultFolder": "پوشه پیش‌فرض" }, "id": { "download": "Unduh", "downloadWith": "Unduh dengan Yood", "watchLater": "Tonton nanti", "saved": "✓ Disimpan", "savedTo": "Disimpan ke Tonton nanti", "removedFrom": "Dihapus dari Tonton nanti", "alreadyIn": "Sudah ada di Tonton nanti", "downloadAll": "Unduh semua", "clear": "Hapus", "empty": "Belum ada video tersimpan", "sent": "Dikirim ke Yood — mengunduh di latar", "cancel": "Batal", "playlistTitle": "Unduh seluruh playlist", "playlistConfirm": "Ini akan mengunduh semua {n} video dalam playlist ini.", "browse": "Telusuri…", "back": "Kembali", "forward": "Maju", "close": "Tutup", "browseFailed": "Tidak dapat membuka pemilih folder", "saveToFolder": "Simpan ke", "defaultFolder": "Folder default" }, "cs": { "download": "Stáhnout", "downloadWith": "Stáhnout s Yood", "watchLater": "Přehrát později", "saved": "✓ Uloženo", "savedTo": "Uloženo do Přehrát později", "removedFrom": "Odebráno z Přehrát později", "alreadyIn": "Již v Přehrát později", "downloadAll": "Stáhnout vše", "clear": "Vymazat", "empty": "Zatím žádná uložená videa", "sent": "Odesláno do Yood — stahuje se na pozadí", "cancel": "Zrušit", "playlistTitle": "Stáhnout celý playlist", "playlistConfirm": "Stáhnou se všechna {n} videa v tomto playlistu.", "browse": "Procházet…", "back": "Zpět", "forward": "Vpřed", "close": "Zavřít", "browseFailed": "Nepodařilo se otevřít výběr složky", "saveToFolder": "Uložit do", "defaultFolder": "Výchozí složka" }, "ro": { "download": "Descarcă", "downloadWith": "Descarcă cu Yood", "watchLater": "Vizionează mai târziu", "saved": "✓ Salvat", "savedTo": "Salvat în Vizionează mai târziu", "removedFrom": "Eliminat din Vizionează mai târziu", "alreadyIn": "Deja în Vizionează mai târziu", "downloadAll": "Descarcă tot", "clear": "Șterge", "empty": "Niciun videoclip salvat încă", "sent": "Trimis la Yood — se descarcă în fundal", "cancel": "Anulează", "playlistTitle": "Descarcă tot playlistul", "playlistConfirm": "Se vor descărca toate cele {n} videoclipuri din acest playlist.", "browse": "Răsfoiește…", "back": "Înapoi", "forward": "Înainte", "close": "Închide", "browseFailed": "Nu s-a putut deschide selectorul de foldere", "saveToFolder": "Salvează în", "defaultFolder": "Dosarul implicit" }, "hu": { "download": "Letöltés", "downloadWith": "Letöltés Yooddal", "watchLater": "Később megnézem", "saved": "✓ Mentve", "savedTo": "Mentve a Később listába", "removedFrom": "Eltávolítva a Később listából", "alreadyIn": "Már a Később listában van", "downloadAll": "Összes letöltése", "clear": "Törlés", "empty": "Még nincs mentett videó", "sent": "Elküldve Yoodnak — letöltés a háttérben", "cancel": "Mégse", "playlistTitle": "Teljes lejátszási lista letöltése", "playlistConfirm": "Ez letölti a lejátszási lista összes {n} videóját.", "browse": "Tallózás…", "back": "Vissza", "forward": "Előre", "close": "Bezárás", "browseFailed": "Nem sikerült megnyitni a mappaválasztót", "saveToFolder": "Mentés ide", "defaultFolder": "Alapért mappa" }, "el": { "download": "Λήψη", "downloadWith": "Λήψη με Yood", "watchLater": "Να δω αργότερα", "saved": "✓ Αποθηκεύτηκε", "savedTo": "Αποθηκεύτηκε στο Να δω αργότερα", "removedFrom": "Καταργήθηκε από Να δω αργότερα", "alreadyIn": "Ήδη στο Να δω αργότερα", "downloadAll": "Λήψη όλων", "clear": "Εκκαθάριση", "empty": "Δεν υπάρχουν αποθηκευμένα βίντεο", "sent": "Στάλθηκε στο Yood — λήψη στο παρασκήνιο", "cancel": "Άκυρο", "playlistTitle": "Λήψη ολόκληρης της λίστας", "playlistConfirm": "Θα γίνει λήψη όλων των {n} βίντεο αυτής της λίστας.", "browse": "Αναζήτηση…", "back": "Πίσω", "forward": "Εμπρός", "close": "Κλείσιμο", "browseFailed": "Δεν ήταν δυνατό το άνοιγμα της επιλογής φακέλου", "saveToFolder": "Αποθήκευση σε", "defaultFolder": "Προεπιλεγμένος φάκελος" }, "sv": { "download": "Ladda ned", "downloadWith": "Ladda ned med Yood", "watchLater": "Titta senare", "saved": "✓ Sparad", "savedTo": "Sparad i Titta senare", "removedFrom": "Borttagen från Titta senare", "alreadyIn": "Finns redan i Titta senare", "downloadAll": "Ladda ned alla", "clear": "Rensa", "empty": "Inga sparade videor ännu", "sent": "Skickat till Yood — laddar ned i bakgrunden", "cancel": "Avbryt", "playlistTitle": "Ladda ned hela spellistan", "playlistConfirm": "Detta laddar ned alla {n} videor i spellistan.", "browse": "Bläddra…", "back": "Tillbaka", "forward": "Framåt", "close": "Stäng", "browseFailed": "Kunde inte öppna mappväljaren", "saveToFolder": "Spara i", "defaultFolder": "Standardmapp" }, "da": { "download": "Download", "downloadWith": "Download med Yood", "watchLater": "Se senere", "saved": "✓ Gemt", "savedTo": "Gemt til Se senere", "removedFrom": "Fjernet fra Se senere", "alreadyIn": "Allerede i Se senere", "downloadAll": "Download alle", "clear": "Ryd", "empty": "Ingen gemte videoer endnu", "sent": "Sendt til Yood — downloader i baggrunden", "cancel": "Annuller", "playlistTitle": "Download hele playlisten", "playlistConfirm": "Dette downloader alle {n} videoer på playlisten.", "browse": "Gennemse…", "back": "Tilbage", "forward": "Fremad", "close": "Luk", "browseFailed": "Kunne ikke åbne mappevælgeren", "saveToFolder": "Gem i", "defaultFolder": "Standardmappe" }, "fi": { "download": "Lataa", "downloadWith": "Lataa Yoodilla", "watchLater": "Katso myöhemmin", "saved": "✓ Tallennettu", "savedTo": "Tallennettu Katsottavaksi myöhemmin", "removedFrom": "Poistettu Katsottavaksi myöhemmin", "alreadyIn": "Jo Katsottavaksi myöhemmin -listalla", "downloadAll": "Lataa kaikki", "clear": "Tyhjennä", "empty": "Ei tallennettuja videoita", "sent": "Lähetetty Yoodiin — ladataan taustalla", "cancel": "Peruuta", "playlistTitle": "Lataa koko soittolista", "playlistConfirm": "Tämä lataa soittolistan kaikki {n} videota.", "browse": "Selaa…", "back": "Takaisin", "forward": "Eteenpäin", "close": "Sulje", "browseFailed": "Kansionvalitsinta ei voitu avata", "saveToFolder": "Tallenna kohteeseen", "defaultFolder": "Oletuskansio" }, "no": { "download": "Last ned", "downloadWith": "Last ned med Yood", "watchLater": "Se senere", "saved": "✓ Lagret", "savedTo": "Lagret i Se senere", "removedFrom": "Fjernet fra Se senere", "alreadyIn": "Finnes allerede i Se senere", "downloadAll": "Last ned alle", "clear": "Tøm", "empty": "Ingen lagrede videoer ennå", "sent": "Sendt til Yood — laster ned i bakgrunnen", "cancel": "Avbryt", "playlistTitle": "Last ned hele spillelisten", "playlistConfirm": "Dette laster ned alle {n} videoene i spillelisten.", "browse": "Bla gjennom…", "back": "Tilbake", "forward": "Framover", "close": "Lukk", "browseFailed": "Kunne ikke åpne mappevelgeren", "saveToFolder": "Lagre i", "defaultFolder": "Standardmappe" }, "th": { "download": "ดาวน์โหลด", "downloadWith": "ดาวน์โหลดด้วย Yood", "watchLater": "ดูภายหลัง", "saved": "✓ บันทึกแล้ว", "savedTo": "บันทึกแล้ว ดูภายหลัง", "removedFrom": "ลบออก ดูภายหลัง", "alreadyIn": "อยู่ใน ดูภายหลัง", "downloadAll": "ดาวน์โหลดทั้งหมด", "clear": "ล้าง", "empty": "ยังไม่มีวิดีโอที่บันทึก", "sent": "ส่งไป Yood แล้ว — กำลังดาวน์โหลดอยู่เบื้องหลัง", "cancel": "ยกเลิก", "playlistTitle": "ดาวน์โหลดเพลย์ลิสต์ทั้งหมด", "playlistConfirm": "การดำเนินการนี้จะดาวน์โหลดวิดีโอทั้งหมด {n} รายการในเพลย์ลิสต์", "browse": "เรียกดู…", "back": "ย้อนกลับ", "forward": "ไปข้างหน้า", "close": "ปิด", "browseFailed": "ไม่สามารถเปิดตัวเลือกโฟลเดอร์ได้", "saveToFolder": "บันทึกไปที่", "defaultFolder": "โฟลเดอร์เริ่มต้น" }, "vi": { "download": "Tải xuống", "downloadWith": "Tải xuống với Yood", "watchLater": "Xem sau", "saved": "✓ Đã lưu", "savedTo": "Đã lưu vào Xem sau", "removedFrom": "Đã xóa khỏi Xem sau", "alreadyIn": "Đã có trong Xem sau", "downloadAll": "Tải tất cả", "clear": "Xóa", "empty": "Chưa có video nào được lưu", "sent": "Đã gửi tới Yood — đang tải trong nền", "cancel": "Hủy", "playlistTitle": "Tải toàn bộ danh sách phát", "playlistConfirm": "Thao tác này sẽ tải tất cả {n} video trong danh sách phát.", "browse": "Duyệt…", "back": "Quay lại", "forward": "Tiếp tục", "close": "Đóng", "browseFailed": "Không thể mở trình chọn thư mục", "saveToFolder": "Lưu vào", "defaultFolder": "Thư mục mặc định" }, "ms": { "download": "Muat turun", "downloadWith": "Muat turun dengan Yood", "watchLater": "Tonton kemudian", "saved": "✓ Disimpan", "savedTo": "Disimpan ke Tonton kemudian", "removedFrom": "Dibuang dari Tonton kemudian", "alreadyIn": "Sudah ada dalam Tonton kemudian", "downloadAll": "Muat turun semua", "clear": "Padam", "empty": "Tiada video disimpan lagi", "sent": "Dihantar ke Yood — memuat turun di latar", "cancel": "Batal", "playlistTitle": "Muat turun keseluruhan senarai main", "playlistConfirm": "Ini akan memuat turun kesemua {n} video dalam senarai main ini.", "browse": "Semak imbas…", "back": "Kembali", "forward": "Maju", "close": "Tutup", "browseFailed": "Tidak dapat membuka pemilih folder", "saveToFolder": "Simpan ke", "defaultFolder": "Folder lalai" }, "ca": { "download": "Baixa", "downloadWith": "Baixa amb Yood", "watchLater": "Mira-ho més tard", "saved": "✓ Desat", "savedTo": "Desat per mirar-ho més tard", "removedFrom": "Eliminat de Mira-ho més tard", "alreadyIn": "Ja és a Mira-ho més tard", "downloadAll": "Baixa-ho tot", "clear": "Esborra", "empty": "Encara no hi ha vídeos desats", "sent": "Enviat a Yood — baixant en segon pla", "cancel": "Cancel·la", "playlistTitle": "Baixa la playlist sencera", "playlistConfirm": "Això baixarà els {n} vídeos de la playlist.", "browse": "Examina…", "back": "Enrere", "forward": "Endavant", "close": "Tanca", "browseFailed": "No s'ha pogut obrir el selector de carpetes", "saveToFolder": "Desa a", "defaultFolder": "Carpeta per defecte" }, "hr": { "download": "Preuzmi", "downloadWith": "Preuzmi s Yood", "watchLater": "Pogledaj kasnije", "saved": "✓ Spremljeno", "savedTo": "Spremljeno u Pogledaj kasnije", "removedFrom": "Uklonjeno iz Pogledaj kasnije", "alreadyIn": "Već u Pogledaj kasnije", "downloadAll": "Preuzmi sve", "clear": "Očisti", "empty": "Još nema spremljenih videozapisa", "sent": "Poslano u Yood — preuzima se u pozadini", "cancel": "Odustani", "playlistTitle": "Preuzmi cijeli popis", "playlistConfirm": "Time će se preuzeti svih {n} videozapisa s popisa.", "browse": "Pregledaj…", "back": "Natrag", "forward": "Naprijed", "close": "Zatvori", "browseFailed": "Nije moguće otvoriti odabir mape", "saveToFolder": "Spremi u", "defaultFolder": "Zadana mapa" }, "sk": { "download": "Stiahnuť", "downloadWith": "Stiahnuť s Yood", "watchLater": "Prehrať neskôr", "saved": "✓ Uložené", "savedTo": "Uložené do Prehrať neskôr", "removedFrom": "Odobrané z Prehrať neskôr", "alreadyIn": "Už v Prehrať neskôr", "downloadAll": "Stiahnuť všetko", "clear": "Vymazať", "empty": "Zatiaľ žiadne uložené videá", "sent": "Odoslané do Yood — sťahuje sa na pozadí", "cancel": "Zrušiť", "playlistTitle": "Stiahnuť celý playlist", "playlistConfirm": "Stiahne sa všetkých {n} videí v tomto playliste.", "browse": "Prehľadávať…", "back": "Späť", "forward": "Vpred", "close": "Zavrieť", "browseFailed": "Nepodarilo sa otvoriť výber priečinka", "saveToFolder": "Uložiť do", "defaultFolder": "Predvolený priečinok" }, "sl": { "download": "Prenesi", "downloadWith": "Prenesi z Yood", "watchLater": "Poglej pozneje", "saved": "✓ Shranjeno", "savedTo": "Shranjeno v Poglej pozneje", "removedFrom": "Odstranjeno iz Poglej pozneje", "alreadyIn": "Že v Poglej pozneje", "downloadAll": "Prenesi vse", "clear": "Počisti", "empty": "Še ni shranjenih videoposnetkov", "sent": "Poslano v Yood — prenaša se v ozadju", "cancel": "Prekliči", "playlistTitle": "Prenesi celoten seznam", "playlistConfirm": "To bo preneslo vseh {n} videoposnetkov s tega seznama.", "browse": "Prebrskaj…", "back": "Nazaj", "forward": "Naprej", "close": "Zapri", "browseFailed": "Ni mogoče odpreti izbirnika mape", "saveToFolder": "Shrani v", "defaultFolder": "Privzeta mapa" }, "sr": { "download": "Preuzmi", "downloadWith": "Preuzmi sa Yood", "watchLater": "Pogledaj kasnije", "saved": "✓ Sačuvano", "savedTo": "Sačuvano u Pogledaj kasnije", "removedFrom": "Uklonjeno iz Pogledaj kasnije", "alreadyIn": "Već u Pogledaj kasnije", "downloadAll": "Preuzmi sve", "clear": "Obriši", "empty": "Još nema sačuvanih videozapisa", "sent": "Poslato u Yood — preuzima se u pozadini", "cancel": "Otkaži", "playlistTitle": "Preuzmi celu plejlistu", "playlistConfirm": "Time će se preuzeti svih {n} videozapisa sa plejliste.", "browse": "Potraži…", "back": "Nazad", "forward": "Napred", "close": "Zatvori", "browseFailed": "Nije moguće otvoriti izbor fascikle", "saveToFolder": "Sačuvaj u", "defaultFolder": "Podrazumevana fascikla" }, "bg": { "download": "Изтегли", "downloadWith": "Изтегли с Yood", "watchLater": "Гледай по-късно", "saved": "✓ Запазено", "savedTo": "Запазено в Гледай по-късно", "removedFrom": "Премахнато от Гледай по-късно", "alreadyIn": "Вече в Гледай по-късно", "downloadAll": "Изтегли всичко", "clear": "Изчисти", "empty": "Все още няма запазени видеа", "sent": "Изпратено към Yood — изтегля се във фона", "cancel": "Отказ", "playlistTitle": "Изтегли целия плейлист", "playlistConfirm": "Това ще изтегли всички {n} видеа от този плейлист.", "browse": "Преглед…", "back": "Назад", "forward": "Напред", "close": "Затвори", "browseFailed": "Неуспешно отваряне на избора на папка", "saveToFolder": "Запази в", "defaultFolder": "Папка по подразбиране" }, "lt": { "download": "Atsisiųsti", "downloadWith": "Atsisiųsti su Yood", "watchLater": "Žiūrėti vėliau", "saved": "✓ Išsaugota", "savedTo": "Išsaugota į Žiūrėti vėliau", "removedFrom": "Pašalinta iš Žiūrėti vėliau", "alreadyIn": "Jau yra Žiūrėti vėliau", "downloadAll": "Atsisiųsti viską", "clear": "Išvalyti", "empty": "Dar nėra išsaugotų vaizdo įrašų", "sent": "Išsiųsta į Yood — atsisiunčiama fone", "cancel": "Atšaukti", "playlistTitle": "Atsisiųsti visą grojaraštį", "playlistConfirm": "Bus atsisiųsti visi {n} šio grojaraščio vaizdo įrašai.", "browse": "Naršyti…", "back": "Atgal", "forward": "Pirmyn", "close": "Uždaryti", "browseFailed": "Nepavyko atidaryti aplanko pasirinkimo", "saveToFolder": "Įrašyti į", "defaultFolder": "Numatytasis aplankas" }, "lv": { "download": "Lejupielādēt", "downloadWith": "Lejupielādēt ar Yood", "watchLater": "Skatīties vēlāk", "saved": "✓ Saglabāts", "savedTo": "Saglabāts sadaļā Skatīties vēlāk", "removedFrom": "Noņemts no Skatīties vēlāk", "alreadyIn": "Jau ir sadaļā Skatīties vēlāk", "downloadAll": "Lejupielādēt visu", "clear": "Notīrīt", "empty": "Vēl nav saglabātu videoklipu", "sent": "Nosūtīts uz Yood — lejupielādē fonā", "cancel": "Atcelt", "playlistTitle": "Lejupielādēt visu atskaņošanas sarakstu", "playlistConfirm": "Tiks lejupielādēti visi {n} šī saraksta videoklipi.", "browse": "Pārlūkot…", "back": "Atpakaļ", "forward": "Uz priekšu", "close": "Aizvērt", "browseFailed": "Neizdevās atvērt mapes izvēli", "saveToFolder": "Saglabāt mapē", "defaultFolder": "Noklusējuma mape" }, "et": { "download": "Laadi alla", "downloadWith": "Laadi alla Yoodiga", "watchLater": "Vaata hiljem", "saved": "✓ Salvestatud", "savedTo": "Salvestatud hiljem vaatamiseks", "removedFrom": "Eemaldatud hiljem vaatamise alt", "alreadyIn": "Juba hiljem vaatamise all", "downloadAll": "Laadi kõik alla", "clear": "Tühjenda", "empty": "Salvestatud videoid veel pole", "sent": "Saadetud Yoodi — laadib taustal alla", "cancel": "Loobu", "playlistTitle": "Laadi alla terve esitusloend", "playlistConfirm": "See laadib alla esitusloendi kõik {n} videot.", "browse": "Sirvi…", "back": "Tagasi", "forward": "Edasi", "close": "Sulge", "browseFailed": "Kaustavalijat ei saanud avada", "saveToFolder": "Salvesta kausta", "defaultFolder": "Vaikekaust" }, "az": { "download": "Yüklə", "downloadWith": "Yood ilə yüklə", "watchLater": "Daha sonra izlə", "saved": "✓ Saxlanıldı", "savedTo": "Daha sonra izlə siyahısına saxlanıldı", "removedFrom": "Daha sonra izlə siyahısından silindi", "alreadyIn": "Artıq Daha sonra izlə-dədir", "downloadAll": "Hamısını yüklə", "clear": "Təmizlə", "empty": "Hələ saxlanılan video yoxdur", "sent": "Yood-a göndərildi — arxa planda yüklənir", "cancel": "Ləğv et", "playlistTitle": "Bütün pleylisti yüklə", "playlistConfirm": "Bu, pleylistdəki {n} videonun hamısını yükləyəcək.", "browse": "Gözdən keçir…", "back": "Geri", "forward": "İrəli", "close": "Bağla", "browseFailed": "Qovluq seçici açıla bilmədi", "saveToFolder": "Saxla", "defaultFolder": "Varsayılan qovluq" }, "kk": { "download": "Жүктеп алы", "downloadWith": "Yood арқылы жүктеп алы", "watchLater": "Кейінірек көру", "saved": "✓ Сақталды", "savedTo": "Кейінірек көруге сақталды", "removedFrom": "Кейінірек көруден жойылды", "alreadyIn": "Кейінірек көруде бар", "downloadAll": "Барлығын жүктеп алы", "clear": "Тазарту", "empty": "Әлі сақталған бейне жоқ", "sent": "Yood-ға жіберілді — фонда жүктелуде", "cancel": "Бас тарту", "playlistTitle": "Бүкіл плейлисті жүктеп ал", "playlistConfirm": "Бұл плейлисттегі барлық {n} бейне жүктеледі.", "browse": "Шолу…", "back": "Артқа", "forward": "Алға", "close": "Жабу", "browseFailed": "Қалта таңдау мүмкін болмады", "saveToFolder": "Сақтау", "defaultFolder": "Әдепкі қалта" }, "af": { "download": "Aflaai", "downloadWith": "Aflaai met Yood", "watchLater": "Kyk later", "saved": "✓ Gestoor", "savedTo": "Gestoor om later te kyk", "removedFrom": "Verwyder van Kyk later", "alreadyIn": "Reeds in Kyk later", "downloadAll": "Laai alles af", "clear": "Maak skoon", "empty": "Nog geen video's gestoor nie", "sent": "Gestuur na Yood — laai in die agtergrond af", "cancel": "Kanselleer", "playlistTitle": "Laai hele snitlys af", "playlistConfirm": "Dit sal al {n} video's in hierdie snitlys aflaai.", "browse": "Blaai…", "back": "Terug", "forward": "Vorentoe", "close": "Maak toe", "browseFailed": "Kon gidskeuse nie oopmaak nie", "saveToFolder": "Stoor in", "defaultFolder": "Verstekgids" }, "am": { "download": "አውርድ", "downloadWith": "በYood አውርድ", "watchLater": "በኋላ ተመልከት", "saved": "✓ ተቀምጧል", "savedTo": "በኋላ ለመመልከት ተቀምጧል", "removedFrom": "ከኋላ ተመልከት ተሰርዟል", "alreadyIn": "አስቀድሞ በኋላ ተመልከት ውስጥ አለ", "downloadAll": "ሁሉንም አውርድ", "clear": "አጽዳ", "empty": "እስካሁን ምንም ቪዲዮ አልተቀመጠም", "sent": "ወደ Yood ተልኳል — በጀርባ እያወረደ ነው", "cancel": "ሰርዝ", "playlistTitle": "ሙሉ ዝርዝሩን አውርድ", "playlistConfirm": "ይህ በዚህ ዝርዝር ውስጥ ያሉ {n} ቪዲዮዎች ሁሉ ያወርዳል።", "browse": "አስስ…", "back": "ተመለስ", "forward": "ወደፊት", "close": "ዝጋ", "browseFailed": "የአቃፊ መራጭ መክፈት አልተቻለም", "saveToFolder": "አስቀምጥ በ", "defaultFolder": "ነባሪ አቃፊ" }, "as": { "download": "ডাউনলোড", "downloadWith": "Yood ৰ সৈতে ডাউনলোড", "watchLater": "পিছত চাওক", "saved": "✓ সংৰক্ষণ কৰা হ'ল", "savedTo": "পিছত চাবলৈ সংৰক্ষণ কৰা হ'ল", "removedFrom": "পিছত চোৱাৰ পৰা আঁতৰোৱা হ'ল", "alreadyIn": "ইতিমধ্যে পিছত চোৱাত আছে", "downloadAll": "সকলো ডাউনলোড কৰক", "clear": "মচক", "empty": "এতিয়াও কোনো ভিডিঅ' সংৰক্ষণ কৰা হোৱা নাই", "sent": "Yood লৈ পঠিওৱা হ'ল — পটভূমিত ডাউনলোড হৈ আছে", "cancel": "বাতিল কৰক", "playlistTitle": "গোটেই প্লেলিষ্ট ডাউনলোড কৰক", "playlistConfirm": "ইয়াৰ ফলত এই প্লেলিষ্টৰ আটাই {n}টা ভিডিঅ' ডাউনলোড হ'ব।", "browse": "ব্ৰাউজ কৰক…", "back": "পিছলৈ", "forward": "আগলৈ", "close": "বন্ধ কৰক", "browseFailed": "ফ'ল্ডাৰ বাছনি খুলিব পৰা নগ'ল", "saveToFolder": "ত সংৰক্ষণ কৰক", "defaultFolder": "ডিফ'ল্ট ফ'ল্ডাৰ" }, "be": { "download": "Спампаваць", "downloadWith": "Спампаваць з Yood", "watchLater": "Глядзець пазней", "saved": "✓ Захавана", "savedTo": "Захавана ў «Глядзець пазней»", "removedFrom": "Выдалена з «Глядзець пазней»", "alreadyIn": "Ужо ў «Глядзець пазней»", "downloadAll": "Спампаваць усё", "clear": "Ачысціць", "empty": "Пакуль нічога не захавана", "sent": "Адпраўлена ў Yood — загрузка ў фоне", "cancel": "Скасаваць", "playlistTitle": "Спампаваць увесь плэйліст", "playlistConfirm": "Будуць спампаваны ўсе {n} відэа з гэтага плэйліста.", "browse": "Агляд…", "back": "Назад", "forward": "Наперад", "close": "Закрыць", "browseFailed": "Не ўдалося адкрыць выбар папкі", "saveToFolder": "Захаваць у", "defaultFolder": "Папка па змаўчанні" }, "bn": { "download": "ডাউনলোড", "downloadWith": "Yood দিয়ে ডাউনলোড", "watchLater": "পরে দেখুন", "saved": "✓ সংরক্ষিত", "savedTo": "পরে দেখার জন্য সংরক্ষিত", "removedFrom": "পরে দেখা থেকে সরানো হয়েছে", "alreadyIn": "ইতিমধ্যে পরে দেখায় আছে", "downloadAll": "সব ডাউনলোড করুন", "clear": "মুছুন", "empty": "এখনও কোনো ভিডিও সংরক্ষণ করা হয়নি", "sent": "Yood-এ পাঠানো হয়েছে — ব্যাকগ্রাউন্ডে ডাউনলোড হচ্ছে", "cancel": "বাতিল", "playlistTitle": "সম্পূর্ণ প্লেলিস্ট ডাউনলোড করুন", "playlistConfirm": "এতে এই প্লেলিস্টের সব {n}টি ভিডিও ডাউনলোড হবে।", "browse": "ব্রাউজ করুন…", "back": "পেছনে", "forward": "সামনে", "close": "বন্ধ করুন", "browseFailed": "ফোল্ডার বাছাই খোলা যায়নি", "saveToFolder": "এতে সংরক্ষণ করুন", "defaultFolder": "ডিফল্ট ফোল্ডার" }, "bs": { "download": "Preuzmi", "downloadWith": "Preuzmi s Yood", "watchLater": "Pogledaj kasnije", "saved": "✓ Sačuvano", "savedTo": "Sačuvano u Pogledaj kasnije", "removedFrom": "Uklonjeno iz Pogledaj kasnije", "alreadyIn": "Već u Pogledaj kasnije", "downloadAll": "Preuzmi sve", "clear": "Očisti", "empty": "Još nema sačuvanih videozapisa", "sent": "Poslano u Yood — preuzima se u pozadini", "cancel": "Otkaži", "playlistTitle": "Preuzmi cijelu plejlistu", "playlistConfirm": "Time će se preuzeti svih {n} videozapisa sa plejliste.", "browse": "Pretraži…", "back": "Nazad", "forward": "Naprijed", "close": "Zatvori", "browseFailed": "Nije moguće otvoriti izbor mape", "saveToFolder": "Sačuvaj u", "defaultFolder": "Zadana mapa" }, "en-GB": { "download": "Download", "downloadWith": "Download with Yood", "watchLater": "Watch later", "saved": "✓ Saved", "savedTo": "Saved to Watch later", "removedFrom": "Removed from Watch later", "alreadyIn": "Already in Watch later", "downloadAll": "Download all", "clear": "Clear", "empty": "No videos saved yet", "sent": "Sent to Yood — downloading in the background", "cancel": "Cancel", "playlistTitle": "Download entire playlist", "playlistConfirm": "This will download all {n} videos in this playlist.", "browse": "Browse…", "back": "Back", "forward": "Forward", "close": "Close", "browseFailed": "Could not open folder picker", "saveToFolder": "Save to", "defaultFolder": "Default folder" }, "es-419": { "download": "Descargar", "downloadWith": "Descargar con Yood", "watchLater": "Ver más tarde", "saved": "✓ Guardado", "savedTo": "Guardado para ver más tarde", "removedFrom": "Eliminado de Ver más tarde", "alreadyIn": "Ya está en Ver más tarde", "downloadAll": "Descargar todo", "clear": "Borrar", "empty": "Aún no hay videos guardados", "sent": "Enviado a Yood — descargando en segundo plano", "cancel": "Cancelar", "playlistTitle": "Descargar la lista completa", "playlistConfirm": "Esto descargará los {n} videos de la lista.", "browse": "Examinar…", "back": "Atrás", "forward": "Adelante", "close": "Cerrar", "browseFailed": "No se pudo abrir el selector de carpetas", "saveToFolder": "Guardar en", "defaultFolder": "Carpeta predeterminada" }, "eu": { "download": "Deskargatu", "downloadWith": "Deskargatu Yood-ekin", "watchLater": "Geroago ikusi", "saved": "✓ Gordeta", "savedTo": "Geroago ikusteko gordea", "removedFrom": "Geroago ikusitik kenduta", "alreadyIn": "Jadanik Geroago ikusin", "downloadAll": "Dena deskargatu", "clear": "Garbitu", "empty": "Oraindik ez da bideorik gorde", "sent": "Yood-era bidalita — atzealdean deskargatzen", "cancel": "Utzi", "playlistTitle": "Playlist osoa deskargatu", "playlistConfirm": "Horrek playlisteko {n} bideo guztiak deskargatuko ditu.", "browse": "Arakatu…", "back": "Atzera", "forward": "Aurrera", "close": "Itxi", "browseFailed": "Ezin izan da karpeta-hautatzailea ireki", "saveToFolder": "Gorde hemen", "defaultFolder": "Lehenetsitako karpeta" }, "fil": { "download": "I-download", "downloadWith": "I-download gamit ang Yood", "watchLater": "Panoorin mamaya", "saved": "✓ Na-save", "savedTo": "Na-save sa Panoorin mamaya", "removedFrom": "Inalis sa Panoorin mamaya", "alreadyIn": "Nasa Panoorin mamaya na", "downloadAll": "I-download lahat", "clear": "I-clear", "empty": "Wala pang naka-save na video", "sent": "Ipinadala sa Yood — nagda-download sa background", "cancel": "Kanselahin", "playlistTitle": "I-download ang buong playlist", "playlistConfirm": "Ida-download nito ang lahat ng {n} video sa playlist na ito.", "browse": "Mag-browse…", "back": "Bumalik", "forward": "Magpatuloy", "close": "Isara", "browseFailed": "Hindi mabuksan ang tagapili ng folder", "saveToFolder": "I-save sa", "defaultFolder": "Default na folder" }, "fr-CA": { "download": "Télécharger", "downloadWith": "Télécharger avec Yood", "watchLater": "À regarder plus tard", "saved": "✓ Enregistré", "savedTo": "Enregistré à regarder plus tard", "removedFrom": "Retiré de À regarder plus tard", "alreadyIn": "Déjà dans À regarder plus tard", "downloadAll": "Tout télécharger", "clear": "Effacer", "empty": "Aucune vidéo enregistrée", "sent": "Envoyé à Yood — téléchargement en arrière-plan", "cancel": "Annuler", "playlistTitle": "Télécharger toute la playlist", "playlistConfirm": "Cela téléchargera les {n} vidéos de la playlist.", "browse": "Parcourir…", "back": "Retour", "forward": "Suivant", "close": "Fermer", "browseFailed": "Impossible d'ouvrir le sélecteur de dossier", "saveToFolder": "Enregistrer dans", "defaultFolder": "Dossier par défaut" }, "ga": { "download": "Íoslódáil", "downloadWith": "Íoslódáil le Yood", "watchLater": "Féach ar ball", "saved": "✓ Sábháilte", "savedTo": "Sábháilte le féachaint ar ball", "removedFrom": "Bainithe ó Féach ar ball", "alreadyIn": "I bhFéach ar ball cheana", "downloadAll": "Íoslódáil uile", "clear": "Glan", "empty": "Níl aon fhíseán sábháilte fós", "sent": "Seolta chuig Yood — á íoslódáil sa chúlra", "cancel": "Cealaigh", "playlistTitle": "Íoslódáil an seinmliosta iomlán", "playlistConfirm": "Íoslódálfar gach ceann de na {n} físeán sa seinmliosta seo.", "browse": "Brabhsáil…", "back": "Ar ais", "forward": "Ar aghaidh", "close": "Dún", "browseFailed": "Níorbh fhéidir roghnóir fillteán a oscailt", "saveToFolder": "Sábháil in", "defaultFolder": "Fillteán réamhshocraithe" }, "gl": { "download": "Descargar", "downloadWith": "Descargar con Yood", "watchLater": "Ver máis tarde", "saved": "✓ Gardado", "savedTo": "Gardado para ver máis tarde", "removedFrom": "Eliminado de Ver máis tarde", "alreadyIn": "Xa está en Ver máis tarde", "downloadAll": "Descargar todo", "clear": "Borrar", "empty": "Aínda non hai vídeos gardados", "sent": "Enviado a Yood — descargando en segundo plano", "cancel": "Cancelar", "playlistTitle": "Descargar a lista completa", "playlistConfirm": "Isto descargará os {n} vídeos da lista.", "browse": "Examinar…", "back": "Atrás", "forward": "Adiante", "close": "Pechar", "browseFailed": "Non se puido abrir o selector de cartafoles", "saveToFolder": "Gardar en", "defaultFolder": "Cartafol predeterminado" }, "gu": { "download": "ડાઉનલોડ", "downloadWith": "Yood સાથે ડાઉનલોડ", "watchLater": "પછીથી જુઓ", "saved": "✓ સાચવેલ", "savedTo": "પછીથી જોવા માટે સાચવેલ", "removedFrom": "પછીથી જુઓમાંથી દૂર કરેલ", "alreadyIn": "પહેલેથી પછીથી જુઓમાં છે", "downloadAll": "બધું ડાઉનલોડ કરો", "clear": "સાફ કરો", "empty": "હજુ કોઈ વિડિઓ સાચવેલ નથી", "sent": "Yood પર મોકલેલ — બેકગ્રાઉન્ડમાં ડાઉનલોડ થઈ રહ્યું છે", "cancel": "રદ કરો", "playlistTitle": "આખી પ્લેલિસ્ટ ડાઉનલોડ કરો", "playlistConfirm": "આનાથી આ પ્લેલિસ્ટના તમામ {n} વિડિઓ ડાઉનલોડ થશે.", "browse": "બ્રાઉઝ કરો…", "back": "પાછળ", "forward": "આગળ", "close": "બંધ કરો", "browseFailed": "ફોલ્ડર પસંદગી ખોલી શકાઈ નથી", "saveToFolder": "માં સાચવો", "defaultFolder": "ડિફોલ્ટ ફોલ્ડર" }, "hy": { "download": "Ներբեռնել", "downloadWith": "Ներբեռնել Yood-ով", "watchLater": "Դիտել ավելի ուշ", "saved": "✓ Պահպանված է", "savedTo": "Պահպանված է «Դիտել ավելի ուշ»-ում", "removedFrom": "Հեռացված է «Դիտել ավելի ուշ»-ից", "alreadyIn": "Արդեն «Դիտել ավելի ուշ»-ում է", "downloadAll": "Ներբեռնել բոլորը", "clear": "Մաքրել", "empty": "Դեռ ոչ մի տեսանյութ պահպանված չէ", "sent": "Ուղարկվել է Yood — ներբեռնումը ֆոնին", "cancel": "Չեղարկել", "playlistTitle": "Ներբեռնել ամբողջ ցուցակը", "playlistConfirm": "Սա կներբեռնի ցուցակի բոլոր {n} տեսանյութերը։", "browse": "Դիտել…", "back": "Հետ", "forward": "Առաջ", "close": "Փակել", "browseFailed": "Թղթապանակի ընտրությունը բացել չհաջողվեց", "saveToFolder": "Պահպանել այստեղ", "defaultFolder": "Լռելյայն թղթապանակ" }, "is": { "download": "Sækja", "downloadWith": "Sækja með Yood", "watchLater": "Horfa síðar", "saved": "✓ Vistað", "savedTo": "Vistað til að horfa síðar", "removedFrom": "Fjarlægt úr Horfa síðar", "alreadyIn": "Þegar í Horfa síðar", "downloadAll": "Sækja allt", "clear": "Hreinsa", "empty": "Engin myndbönd vistuð enn", "sent": "Sent til Yood — sækir í bakgrunni", "cancel": "Hætta við", "playlistTitle": "Sækja allan spilunarlistann", "playlistConfirm": "Þetta mun sækja öll {n} myndbönd á listanum.", "browse": "Veldu möppu…", "back": "Til baka", "forward": "Áfram", "close": "Loka", "browseFailed": "Gat ekki opnað möppuval", "saveToFolder": "Vista í", "defaultFolder": "Sjálfgefin mappa" }, "ka": { "download": "ჩამოტვირთვა", "downloadWith": "ჩამოტვირთვა Yood-ით", "watchLater": "ნახვა მოგვიანებით", "saved": "✓ შენახულია", "savedTo": "შენახულია სანახავად მოგვიანებით", "removedFrom": "წაშლილია სიიდან", "alreadyIn": "უკვე არის სიაში", "downloadAll": "ყველას ჩამოტვირთვა", "clear": "გასუფთავება", "empty": "ჯერ არცერთი ვიდეო არ არის შენახული", "sent": "გაგზავნილია Yood-ში — ჩამოტვირთვა ფონზე", "cancel": "გაუქმება", "playlistTitle": "მთლიანი დასაკრავი სიის ჩამოტვირთვა", "playlistConfirm": "ეს ჩამოტვირთავს ამ სიის ყველა {n} ვიდეოს.", "browse": "არჩევა…", "back": "უკან", "forward": "წინ", "close": "დახურვა", "browseFailed": "საქაღალდის არჩევა ვერ მოხერხდა", "saveToFolder": "შენახვა", "defaultFolder": "ნაგულისხმევი საქაღალდე" }, "km": { "download": "ទាញយក", "downloadWith": "ទាញយកជាមួយ Yood", "watchLater": "មើលពេលក្រោយ", "saved": "✓ បានរក្សាទុក", "savedTo": "បានរក្សាទុកដើម្បីមើលពេលក្រោយ", "removedFrom": "បានលុបចេញពីមើលពេលក្រោយ", "alreadyIn": "មាននៅក្នុងមើលពេលក្រោយរួចហើយ", "downloadAll": "ទាញយកទាំងអស់", "clear": "សម្អាត", "empty": "មិនទាន់មានវីដេអូដែលបានរក្សាទុក", "sent": "បានផ្ញើទៅ Yood — កំពុងទាញយកក្នុងផ្ទៃខាងក្រោយ", "cancel": "បោះបង់", "playlistTitle": "ទាញយកបញ្ជីទាំងមូល", "playlistConfirm": "នេះនឹងទាញយកវីដេអូទាំង {n} នៅក្នុងបញ្ជីនេះ។", "browse": "រកមើល…", "back": "ត្រឡប់", "forward": "ទៅមុខ", "close": "បិទ", "browseFailed": "មិនអាចបើកកម្មវិធីជ្រើសរើសថតបានទេ", "saveToFolder": "រក្សាទុកក្នុង", "defaultFolder": "ថតលំនាំដើម" }, "kn": { "download": "ಡೌನ್‌ಲೋಡ್", "downloadWith": "Yood ಜೊತೆ ಡೌನ್‌ಲೋಡ್", "watchLater": "ನಂತರ ನೋಡಿ", "saved": "✓ ಉಳಿಸಲಾಗಿದೆ", "savedTo": "ನಂತರ ನೋಡಲು ಉಳಿಸಲಾಗಿದೆ", "removedFrom": "ನಂತರ ನೋಡುವುದರಿಂದ ತೆಗೆದುಹಾಕಲಾಗಿದೆ", "alreadyIn": "ಈಗಾಗಲೇ ನಂತರ ನೋಡುವುದರಲ್ಲಿದೆ", "downloadAll": "ಎಲ್ಲವನ್ನೂ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", "clear": "ತೆರವುಗೊಳಿಸಿ", "empty": "ಇನ್ನೂ ಯಾವುದೇ ವೀಡಿಯೊ ಉಳಿಸಲಾಗಿಲ್ಲ", "sent": "Yood ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ — ಹಿನ್ನೆಲೆಯಲ್ಲಿ ಡೌನ್‌ಲೋಡ್ ಆಗುತ್ತಿದೆ", "cancel": "ರದ್ದುಮಾಡಿ", "playlistTitle": "ಸಂಪೂರ್ಣ ಪ್ಲೇಲಿಸ್ಟ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", "playlistConfirm": "ಇದು ಈ ಪ್ಲೇಲಿಸ್ಟ್‌ನ ಎಲ್ಲಾ {n} ವೀಡಿಯೊಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡುತ್ತದೆ.", "browse": "ಬ್ರೌಸ್ ಮಾಡಿ…", "back": "ಹಿಂದೆ", "forward": "ಮುಂದೆ", "close": "ಮುಚ್ಚಿ", "browseFailed": "ಫೋಲ್ಡರ್ ಆಯ್ಕೆ ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ", "saveToFolder": "ಉಳಿಸಿ", "defaultFolder": "ಡೀಫಾಲ್ಟ್ ಫೋಲ್ಡರ್" }, "ky": { "download": "Жүктөп алуу", "downloadWith": "Yood менен жүктөп алуу", "watchLater": "Кийинчерээк көрүү", "saved": "✓ Сакталды", "savedTo": "Кийинчерээк көрүүгө сакталды", "removedFrom": "Кийинчерээк көрүүдөн өчүрүлдү", "alreadyIn": "Кийинчерээк көрүүдө бар", "downloadAll": "Баарын жүктөп алуу", "clear": "Тазалоо", "empty": "Азырынча сакталган видео жок", "sent": "Yood'ко жөнөтүлдү — фондо жүктөлүүдө", "cancel": "Жокко чыгаруу", "playlistTitle": "Бүт плейлистта жүктөп алуу", "playlistConfirm": "Бул плейлисттеги {n} видеонун баарын жүктөйт.", "browse": "Карап чыгуу…", "back": "Артка", "forward": "Алдыга", "close": "Жабуу", "browseFailed": "Папка тандагычты ачуу мүмкүн болбоду", "saveToFolder": "Сактоо", "defaultFolder": "Демейки папка" }, "lo": { "download": "ດາວໂຫລດ", "downloadWith": "ດາວໂຫລດດ້ວຍ Yood", "watchLater": "ເບິ່ງພາຍຫລັງ", "saved": "✓ ບັນທຶກແລ້ວ", "savedTo": "ບັນທຶກໄວ້ເບິ່ງພາຍຫລັງ", "removedFrom": "ລຶບອອກຈາກເບິ່ງພາຍຫລັງ", "alreadyIn": "ມີຢູ່ໃນເບິ່ງພາຍຫລັງແລ້ວ", "downloadAll": "ດາວໂຫລດທັງໝົດ", "clear": "ລຶບລ້າງ", "empty": "ຍັງບໍ່ມີວິດີໂອທີ່ບັນທຶກ", "sent": "ສົ່ງໄປ Yood ແລ້ວ — ກຳລັງດາວໂຫລດຢູ່ເບື້ອງຫລັງ", "cancel": "ຍົກເລີກ", "playlistTitle": "ດາວໂຫລດເພລยໝລິດທັງໝົດ", "playlistConfirm": "ນີ້ຈະດາວໂຫລດວິດີໂອທັງ {n} ອັນໃນເພລยໝລີນນີ້.", "browse": "ເລືອກເບິ່ງ…", "back": "ກັບຄືນ", "forward": "ໄປໜ້າ", "close": "ປິດ", "browseFailed": "ບໍ່ສາມາດເປີດຕົວເລືອກໂຟນເດີໄດ້", "saveToFolder": "ບັນທຶກລົງ", "defaultFolder": "ໂຟນເດີຄ່າເລີ່ມຕົ້ນ" }, "mk": { "download": "Преземи", "downloadWith": "Преземи со Yood", "watchLater": "Гледај подоцна", "saved": "✓ Зачувано", "savedTo": "Зачувано во Гледај подоцна", "removedFrom": "Отстрането од Гледај подоцна", "alreadyIn": "Веќе во Гледај подоцна", "downloadAll": "Преземи сè", "clear": "Исчисти", "empty": "Сè уште нема зачувани видеа", "sent": "Испратено до Yood — се презема во позадина", "cancel": "Откажи", "playlistTitle": "Преземи ја целата плејлиста", "playlistConfirm": "Ова ќе ги преземе сите {n} видеа од плејлистата.", "browse": "Пребарај…", "back": "Назад", "forward": "Напред", "close": "Затвори", "browseFailed": "Не може да се отвори изборот на папка", "saveToFolder": "Зачувај во", "defaultFolder": "Стандардна папка" }, "ml": { "download": "ഡൗൺലോഡ്", "downloadWith": "Yood ഉപയോഗിച്ച് ഡൗൺലോഡ്", "watchLater": "പിന്നീട് കാണുക", "saved": "✓ സംരക്ഷിച്ചു", "savedTo": "പിന്നീട് കാണാൻ സംരക്ഷിച്ചു", "removedFrom": "പിന്നീട് കാണുകയിൽ നിന്ന് നീക്കംചെയ്തു", "alreadyIn": "ഇതിനകം പിന്നീട് കാണുകയിൽ ഉണ്ട്", "downloadAll": "എല്ലാം ഡൗൺലോഡ് ചെയ്യുക", "clear": "മായ്ക്കുക", "empty": "ഇതുവരെ വീഡിയോകളൊന്നും സംരക്ഷിച്ചിട്ടില്ല", "sent": "Yood-ലേക്ക് അയച്ചു — പശ്ചാത്തലത്തിൽ ഡൗൺലോഡ് ചെയ്യുന്നു", "cancel": "റദ്ദാക്കുക", "playlistTitle": "മുഴുവൻ പ്ലേലിസ്റ്റും ഡൗൺലോഡ് ചെയ്യുക", "playlistConfirm": "ഇത് ഈ പ്ലേലിസ്റ്റിലെ എല്ലാ {n} വീഡിയോകളും ഡൗൺലോഡ് ചെയ്യും.", "browse": "ബ്രൗസ് ചെയ്യുക…", "back": "പിന്നോട്ട്", "forward": "മുന്നോട്ട്", "close": "അടയ്ക്കുക", "browseFailed": "ഫോൾഡർ തിരഞ്ഞെടുക്കൽ തുറക്കാനായില്ല", "saveToFolder": "സംരക്ഷിക്കുക", "defaultFolder": "സ്ഥിര ഫോൾഡർ" }, "mn": { "download": "Татаж авах", "downloadWith": "Yood-оор татаж авах", "watchLater": "Дараа үзэх", "saved": "✓ Хадгалагдлаа", "savedTo": "Дараа үзэхэд хадгалагдлаа", "removedFrom": "Дараа үзэхээс хасагдлаа", "alreadyIn": "Дараа үзэхэд аль хэдийн байна", "downloadAll": "Бүгдийг татаж авах", "clear": "Цэвэрлэх", "empty": "Одоогоор хадгалсан видео алга", "sent": "Yood руу илгээгдлээ — ар талд татагдаж байна", "cancel": "Цуцлах", "playlistTitle": "Бүтэн тоглуулах жагсаалтыг татах", "playlistConfirm": "Энэ нь жагсаалтын {n} видеог бүгдийг татна.", "browse": "Үзэх…", "back": "Буцах", "forward": "Урагшлах", "close": "Хаах", "browseFailed": "Хавтас сонгогчийг нээж чадсангүй", "saveToFolder": "Хадгалах", "defaultFolder": "Үндсэн хавтас" }, "mr": { "download": "डाउनलोड", "downloadWith": "Yood सह डाउनलोड", "watchLater": "नंतर पहा", "saved": "✓ जतन केले", "savedTo": "नंतर पाहण्यासाठी जतन केले", "removedFrom": "नंतर पहामधून काढले", "alreadyIn": "आधीच नंतर पहामध्ये आहे", "downloadAll": "सर्व डाउनलोड करा", "clear": "साफ करा", "empty": "अद्याप कोणताही व्हिडिओ जतन केलेला नाही", "sent": "Yood ला पाठवले — बॅकग्राउंडमध्ये डाउनलोड होत आहे", "cancel": "रद्द करा", "playlistTitle": "संपूर्ण प्लेलिस्ट डाउनलोड करा", "playlistConfirm": "यामुळे या प्लेलिस्टमधील सर्व {n} व्हिडिओ डाउनलोड होतील.", "browse": "ब्राउझ करा…", "back": "मागे", "forward": "पुढे", "close": "बंद करा", "browseFailed": "फोल्डर निवड उघडता आली नाही", "saveToFolder": "येथे जतन करा", "defaultFolder": "डीफॉल्ट फोल्डर" }, "mt": { "download": "Niżżel", "downloadWith": "Niżżel b'Yood", "watchLater": "Ara aktar tard", "saved": "✓ Iffrankat", "savedTo": "Iffrankat biex tara aktar tard", "removedFrom": "Imneħħi minn Ara aktar tard", "alreadyIn": "Diġà f'Ara aktar tard", "downloadAll": "Niżżel kollox", "clear": "Naddaf", "empty": "Għad m'hemmx videos iffrankati", "sent": "Mibgħut lil Yood — qed jinniżżel fl-isfond", "cancel": "Ikkanċella", "playlistTitle": "Niżżel il-playlist kollha", "playlistConfirm": "Dan se jniżżel il-{n} videos kollha f'din il-playlist.", "browse": "Ibbrawżja…", "back": "Lura", "forward": "Quddiem", "close": "Agħlaq", "browseFailed": "Ma stajtx tiftaħ l-għażla tal-folder", "saveToFolder": "Iffranka f'", "defaultFolder": "Folder prestabbilit" }, "my": { "download": "ဒေါင်းလုဒ်", "downloadWith": "Yood ဖြင့် ဒေါင်းလုဒ်", "watchLater": "နောက်မှ ကြည့်ရန်", "saved": "✓ သိမ်းဆည်းပြီး", "savedTo": "နောက်မှကြည့်ရန်သိမ်းဆည်းပြီး", "removedFrom": "နောက်မှကြည့်ရန်မှဖယ်ရှားပြီး", "alreadyIn": "နောက်မှကြည့်ရန်တွင်ရှိနှင့်ပြီး", "downloadAll": "အားလုံးဒေါင်းလုဒ်", "clear": "ရှင်းလင်းရန်", "empty": "သိမ်းဆည်းထားသောဗီဒီယိုမရှိသေး", "sent": "Yood သို့ပို့ပြီး — နောက်ကွယ်တွင်ဒေါင်းလုဒ်ဆွဲနေသည်", "cancel": "ပယ်ဖျက်ရန်", "playlistTitle": "ပလေးလစ်တစ်ခုလုံးဒေါင်းလုဒ်", "playlistConfirm": "ဤပလေးလစ်ရှိဗီဒီယို {n} ခုလုံးဒေါင်းလုဒ်ဆွဲမည်။", "browse": "ရှာဖွေ…", "back": "နောက်သို့", "forward": "ရှေ့သို့", "close": "ပိတ်ရန်", "browseFailed": "ဖိုဒါရွေးချယ်မှုဖွင့်၍မရပါ", "saveToFolder": "သိမ်းဆည်းရန်", "defaultFolder": "မူရင်းဖိုဒါ" }, "ne": { "download": "डाउनलोड", "downloadWith": "Yood सँग डाउनलोड", "watchLater": "पछि हेर्नुहोस्", "saved": "✓ सेभ गरियो", "savedTo": "पछि हेर्नका लागि सेभ गरियो", "removedFrom": "पछि हेर्नेबाट हटाइयो", "alreadyIn": "पहिलेदेखि नै पछि हेर्नेमा छ", "downloadAll": "सबै डाउनलोड गर्नुहोस्", "clear": "खाली गर्नुहोस्", "empty": "अहिलेसम्म कुनै भिडियो सेभ गरिएको छैन", "sent": "Yood मा पठाइयो — पृष्ठभूमिमा डाउनलोड हुँदैछ", "cancel": "रद्द गर्नुहोस्", "playlistTitle": "सम्पूर्ण प्लेलिस्ट डाउनलोड गर्नुहोस्", "playlistConfirm": "यसले यस प्लेलिस्टका सबै {n} भिडियो डाउनलोड गर्नेछ।", "browse": "ब्राउज गर्नुहोस्…", "back": "पछाडि", "forward": "अगाडि", "close": "बन्द गर्नुहोस्", "browseFailed": "फोल्डर छनोट खोल्न सकिएन", "saveToFolder": "सेभ गर्नुहोस्", "defaultFolder": "डिफल्ट फोल्डर" }, "or": { "download": "ଡାଉନଲୋଡ୍", "downloadWith": "Yood ସହିତ ଡାଉନଲୋଡ୍", "watchLater": "ପରେ ଦେଖନ୍ତୁ", "saved": "✓ ସଞ୍ଚୟ ହେଲା", "savedTo": "ପରେ ଦେଖିବା ପାଇଁ ସଞ୍ଚୟ ହେଲା", "removedFrom": "ପରେ ଦେଖନ୍ତୁରୁ ହଟାଗଲା", "alreadyIn": "ପୂର୍ବରୁ ପରେ ଦେଖନ୍ତୁରେ ଅଛି", "downloadAll": "ସବୁ ଡାଉନଲୋଡ୍ କରନ୍ତୁ", "clear": "ସଫା କରନ୍ତୁ", "empty": "ବର୍ତ୍ତମାନ ସୁଦ୍ଧା କୌଣସି ଭିଡିଓ ସଞ୍ଚୟ ହୋଇନାହିଁ", "sent": "Yood କୁ ପଠାଗଲା — ପୃଷ୍ଠଭୂମିରେ ଡାଉନଲୋଡ୍ ହେଉଛି", "cancel": "ବାତିଲ କରନ୍ତୁ", "playlistTitle": "ସମ୍ପୂର୍ଣ୍ଣ ପ୍ଲେଲିଷ୍ଟ ଡାଉନଲୋଡ୍ କରନ୍ତୁ", "playlistConfirm": "ଏହା ଏହି ପ୍ଲେଲିଷ୍ଟର ସମସ୍ତ {n} ଭିଡିଓ ଡାଉନଲୋଡ୍ କରିବ।", "browse": "ବ୍ରାଉଜ କରନ୍ତୁ…", "back": "ପଛକୁ", "forward": "ଆଗକୁ", "close": "ବନ୍ଦ କରନ୍ତୁ", "browseFailed": "ଫୋଲ୍ଡର ବାଛିବା ଖୋଲିପାରିଲା ନାହିଁ", "saveToFolder": "ସଞ୍ଚୟ କରନ୍ତୁ", "defaultFolder": "ଡିଫଲ୍ଟ ଫୋଲ୍ଡର" }, "pa": { "download": "ਡਾਊਨਲੋਡ", "downloadWith": "Yood ਨਾਲ ਡਾਊਨਲੋਡ", "watchLater": "ਬਾਅਦ ਵਿੱਚ ਵੇਖੋ", "saved": "✓ ਸੰਭਾਲਿਆ", "savedTo": "ਬਾਅਦ ਵਿੱਚ ਵੇਖਣ ਲਈ ਸੰਭਾਲਿਆ", "removedFrom": "ਬਾਅਦ ਵਿੱਚ ਵੇਖੋ ਵਿੱਚੋਂ ਹਟਾਇਆ", "alreadyIn": "ਪਹਿਲਾਂ ਤੋਂ ਬਾਅਦ ਵਿੱਚ ਵੇਖੋ ਵਿੱਚ ਹੈ", "downloadAll": "ਸਭ ਡਾਊਨਲੋਡ ਕਰੋ", "clear": "ਸਾਫ਼ ਕਰੋ", "empty": "ਅਜੇ ਤੱਕ ਕੋਈ ਵੀਡੀਓ ਸੰਭਾਲਿਆ ਨਹੀਂ", "sent": "Yood ਨੂੰ ਭੇਜਿਆ — ਬੈਕਗ੍ਰਾਊਂਡ ਵਿੱਚ ਡਾਊਨਲੋਡ ਹੋ ਰਿਹਾ ਹੈ", "cancel": "ਰੱਦ ਕਰੋ", "playlistTitle": "ਪੂਰੀ ਪਲੇਲਿਸਟ ਡਾਊਨਲੋਡ ਕਰੋ", "playlistConfirm": "ਇਸ ਨਾਲ ਇਸ ਪਲੇਲਿਸਟ ਦੇ ਸਾਰੇ {n} ਵੀਡੀਓ ਡਾਊਨਲੋਡ ਹੋਣਗੇ।", "browse": "ਬ੍ਰਾਊਜ਼ ਕਰੋ…", "back": "ਪਿੱਛੇ", "forward": "ਅੱਗੇ", "close": "ਬੰਦ ਕਰੋ", "browseFailed": "ਫੋਲਡਰ ਚੋਣ ਖੋਲ੍ਹੀ ਨਹੀਂ ਜਾ ਸਕੀ", "saveToFolder": "ਸੰਭਾਲੋ", "defaultFolder": "ਡਿਫਾਲਟ ਫੋਲਡਰ" }, "pt-PT": { "download": "Transferir", "downloadWith": "Transferir com Yood", "watchLater": "Ver mais tarde", "saved": "✓ Guardado", "savedTo": "Guardado em Ver mais tarde", "removedFrom": "Removido de Ver mais tarde", "alreadyIn": "Já está em Ver mais tarde", "downloadAll": "Transferir tudo", "clear": "Limpar", "empty": "Ainda não há vídeos guardados", "sent": "Enviado para o Yood — a transferir em segundo plano", "cancel": "Cancelar", "playlistTitle": "Transferir a playlist inteira", "playlistConfirm": "Isto vai transferir todos os {n} vídeos desta playlist.", "browse": "Procurar…", "back": "Anterior", "forward": "Seguinte", "close": "Fechar", "browseFailed": "Não foi possível abrir o seletor de pastas", "saveToFolder": "Guardar em", "defaultFolder": "Pasta predefinida" }, "si": { "download": "බාගන්න", "downloadWith": "Yood සමඟ බාගන්න", "watchLater": "පසුව බලන්න", "saved": "✓ සුරකින ලදී", "savedTo": "පසුව බැලීමට සුරකින ලදී", "removedFrom": "පසුව බලන්නෙන් ඉවත් කරන ලදී", "alreadyIn": "දැනටමත් පසුව බලන්නෙහි ඇත", "downloadAll": "සියල්ල බාගන්න", "clear": "හිස් කරන්න", "empty": "සුරකින ලද වීඩියෝ නැත", "sent": "Yood වෙත යවන ලදී — පසුබිමේ බාගත වෙමින්", "cancel": "අවලංගු කරන්න", "playlistTitle": "මුළු ධාවන ලැයිස්තුවම බාගන්න", "playlistConfirm": "මෙය මෙම ලැයිස්තුවේ ඇති {n} වීඩියෝ සියල්ල බාගනු ඇත.", "browse": "පිරික්සන්න…", "back": "ආපසු", "forward": "ඉදිරියට", "close": "වසන්න", "browseFailed": "ෆෝල්ඩර තේරීම විවෘත කළ නොහැකි විය", "saveToFolder": "සුරකින්න", "defaultFolder": "පෙරනිමි ෆෝල්ඩරය" }, "sq": { "download": "Shkarko", "downloadWith": "Shkarko me Yood", "watchLater": "Shiko më vonë", "saved": "✓ Ruajtur", "savedTo": "Ruajtur te Shiko më vonë", "removedFrom": "Hequr nga Shiko më vonë", "alreadyIn": "Tashmë te Shiko më vonë", "downloadAll": "Shkarko të gjitha", "clear": "Pastro", "empty": "Ende asnjë video e ruajtur", "sent": "Dërguar te Yood — po shkarkohet në sfond", "cancel": "Anulo", "playlistTitle": "Shkarko gjithë playlistën", "playlistConfirm": "Kjo do të shkarkojë të {n} videot e kësaj playliste.", "browse": "Shfleto…", "back": "Prapa", "forward": "Para", "close": "Mbyll", "browseFailed": "S'u hap dot zgjedhësi i dosjeve", "saveToFolder": "Ruaj te", "defaultFolder": "Dosja e paracaktuar" }, "sw": { "download": "Pakua", "downloadWith": "Pakua ukitumia Yood", "watchLater": "Tazama baadaye", "saved": "✓ Imehifadhiwa", "savedTo": "Imehifadhiwa katika Tazama baadaye", "removedFrom": "Imeondolewa kutoka Tazama baadaye", "alreadyIn": "Tayari iko katika Tazama baadaye", "downloadAll": "Pakua zote", "clear": "Futa", "empty": "Bado hakuna video zilizohifadhiwa", "sent": "Imetumwa kwa Yood — inapukua chinichini", "cancel": "Ghairi", "playlistTitle": "Pakua orodha yote", "playlistConfirm": "Hii itapakua video zote {n} katika orodha hii.", "browse": "Vinjari…", "back": "Nyuma", "forward": "Mbele", "close": "Funga", "browseFailed": "Imeshindwa kufungua kichaguzi cha folda", "saveToFolder": "Hifadhi katika", "defaultFolder": "Folda chaguo-msingi" }, "ta": { "download": "பதிவிறக்கு", "downloadWith": "Yood உடன் பதிவிறக்கு", "watchLater": "பின்னர் பார்", "saved": "✓ சேமிக்கப்பட்டது", "savedTo": "பின்னர் பார்க்க சேமிக்கப்பட்டது", "removedFrom": "பின்னர் பார் என்பதிலிருந்து நீக்கப்பட்டது", "alreadyIn": "ஏற்கனவே பின்னர் பாரில் உள்ளது", "downloadAll": "அனைத்தையும் பதிவிறக்கு", "clear": "அழி", "empty": "இன்னும் வீடியோக்கள் சேமிக்கப்படவில்லை", "sent": "Yood க்கு அனுப்பப்பட்டது — பின்னணியில் பதிவிறக்கப்படுகிறது", "cancel": "ரத்து", "playlistTitle": "முழு பிளேலிஸ்டையும் பதிவிறக்கு", "playlistConfirm": "இது இந்த பிளேலிஸ்டில் உள்ள அனைத்து {n} வீடியோக்களையும் பதிவிறக்கும்.", "browse": "உலாவு…", "back": "பின்", "forward": "முன்", "close": "மூடு", "browseFailed": "கோப்புறை தேர்வியைத் திறக்க முடியவில்லை", "saveToFolder": "சேமி", "defaultFolder": "இயல்புநிலை கோப்புறை" }, "te": { "download": "డౌన్‌లోడ్", "downloadWith": "Yood తో డౌన్‌లోడ్", "watchLater": "తర్వాత చూడండి", "saved": "✓ సేవ్ చేయబడింది", "savedTo": "తర్వాత చూడటానికి సేవ్ చేయబడింది", "removedFrom": "తర్వాత చూడండి నుండి తొలగించబడింది", "alreadyIn": "ఇప్పటికే తర్వాత చూడండిలో ఉంది", "downloadAll": "అన్నీ డౌన్‌లోడ్ చేయండి", "clear": "క్లియర్ చేయండి", "empty": "ఇంకా వీడియోలేవీ సేవ్ చేయబడలేదు", "sent": "Yood కు పంపబడింది — నేపథ్యంలో డౌన్‌లోడ్ అవుతోంది", "cancel": "రద్దు చేయండి", "playlistTitle": "మొత్తం ప్లేలిస్ట్ డౌన్‌లోడ్ చేయండి", "playlistConfirm": "ఇది ఈ ప్లేలిస్ట్‌లోని అన్ని {n} వీడియోలను డౌన్‌లోడ్ చేస్తుంది.", "browse": "బ్రౌజ్ చేయండి…", "back": "వెనుకకు", "forward": "ముందుకు", "close": "మూసివేయండి", "browseFailed": "ఫోల్డర్ ఎంపిక తెరవడం సాధ్యపడలేదు", "saveToFolder": "సేవ్ చేయండి", "defaultFolder": "డిఫాల్ట్ ఫోల్డర్" }, "ur": { "download": "ڈاؤن لوڈ", "downloadWith": "Yood کے ساتھ ڈاؤن لوڈ", "watchLater": "بعد میں دیکھیں", "saved": "✓ محفوظ ہو گیا", "savedTo": "بعد میں دیکھنے کے لیے محفوظ ہو گیا", "removedFrom": "بعد میں دیکھیں سے ہٹا دیا گیا", "alreadyIn": "پہلے سے بعد میں دیکھیں میں ہے", "downloadAll": "سب ڈاؤن لوڈ کریں", "clear": "صاف کریں", "empty": "ابھی تک کوئی ویڈیو محفوظ نہیں ہوئی", "sent": "Yood کو بھیجا گیا — پس منظر میں ڈاؤن لوڈ ہو رہا ہے", "cancel": "منسوخ کریں", "playlistTitle": "مکمل پلے لسٹ ڈاؤن لوڈ کریں", "playlistConfirm": "یہ اس پلے لسٹ کی تمام {n} ویڈیوز ڈاؤن لوڈ کرے گا۔", "browse": "براؤز کریں…", "back": "پیچھے", "forward": "آگے", "close": "بند کریں", "browseFailed": "فولڈر کا انتخاب نہیں کھولا جا سکا", "saveToFolder": "محفوظ کریں", "defaultFolder": "ڈیفالٹ فولڈر" }, "uz": { "download": "Yuklab olish", "downloadWith": "Yood bilan yuklab olish", "watchLater": "Keyinroq ko‘rish", "saved": "✓ Saqlandi", "savedTo": "Keyinroq ko‘rishga saqlandi", "removedFrom": "Keyinroq ko‘rishdan o‘chirildi", "alreadyIn": "Keyinroq ko‘rishda bor", "downloadAll": "Barchasini yuklab olish", "clear": "Tozalash", "empty": "Hozircha saqlangan videolar yo‘q", "sent": "Yood'ga yuborildi — fonda yuklanmoqda", "cancel": "Bekor qilish", "playlistTitle": "Butun pleylistni yuklab olish", "playlistConfirm": "Bu pleylistdagi {n} videoning barchasini yuklaydi.", "browse": "Ko‘rish…", "back": "Orqaga", "forward": "Oldinga", "close": "Yopish", "browseFailed": "Papka tanlagichni ochib bo‘lmadi", "saveToFolder": "Saqlash", "defaultFolder": "Birlamchi papka" }, "zu": { "download": "Landa", "downloadWith": "Landa nge-Yood", "watchLater": "Bukela kamuva", "saved": "✓ Kulondoloziwe", "savedTo": "Kulondoloziwe kokubuka kamuva", "removedFrom": "Kususiwe kokubuka kamuva", "alreadyIn": "Sesiku kokubuka kamuva", "downloadAll": "Landa konke", "clear": "Sula", "empty": "Awekho amavidiyo alondoloziwe okwamanje", "sent": "Kuthunyelwe ku-Yood — kulanda ngemuva", "cancel": "Khansela", "playlistTitle": "Landa uhlu lonke", "playlistConfirm": "Lokhu kuzolanda wonke amavidiyo angu-{n} kulolu hlu.", "browse": "Phequlula…", "back": "Emuva", "forward": "Phambili", "close": "Vala", "browseFailed": "Yehlulekile ukuvula isikhethi sefolda", "saveToFolder": "Londoloza ku", "defaultFolder": "Ifolda ezenzakalelayo" } };
function yoodPageLang() {
    try {
        try {
            const cfg = window.ytcfg;
            if (cfg) {
                let hl = "";
                try {
                    hl = cfg.get ? cfg.get("HL", "") : "";
                }
                catch {
                    hl = "";
                }
                if (!hl)
                    hl = cfg.data_?.HL || "";
                if (hl && /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(hl))
                    return hl.toLowerCase().replace(/_/g, "-");
            }
        }
        catch { /* next source */ }
        try {
            const legacy = window.yt?.config_?.hl || "";
            if (legacy && /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(legacy))
                return legacy.toLowerCase().replace(/_/g, "-");
        }
        catch { /* next source */ }
        try {
            const m = /(?:^|;\s*)PREF=([^;]*)/.exec(document.cookie || "");
            if (m) {
                const hm = /(?:^|&)hl=([^&]*)/.exec(decodeURIComponent(m[1]));
                if (hm?.[1] && /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(hm[1]))
                    return hm[1].toLowerCase().replace(/_/g, "-");
            }
        }
        catch { /* next source */ }
        const l = document.documentElement?.lang || document.querySelector("html")?.getAttribute("hl") || navigator.language || "en";
        return String(l || "en").toLowerCase().replace(/_/g, "-");
    }
    catch {
        return "en";
    }
}
function yoodT(key) {
    try {
        const lang = yoodPageLang();
        const base = lang.split("-")[0] === "iw" ? "he" : lang.split("-")[0];
        if (base === "zh") {
            if (lang === "zh-tw" || lang === "zh-hk")
                return YOOD_I18N["zh-tw"]?.[key] ?? YOOD_I18N.en[key] ?? key;
            return YOOD_I18N["zh-cn"]?.[key] ?? YOOD_I18N.en[key] ?? key;
        }
        return YOOD_I18N[lang]?.[key] ?? YOOD_I18N[base]?.[key] ?? YOOD_I18N.en[key] ?? key;
    }
    catch {
        return key;
    }
}
const YOOD_SAVE_WORDS = ["save", "saved", "\u05e9\u05de\u05d9\u05e8\u05d4", "\u05e9\u05de\u05d5\u05e8", "\u05e0\u05e9\u05de\u05e8", "\u062d\u0641\u0638", "guardar", "guardado", "enregistrer", "enregistr\u00e9", "speichern", "gespeichert", "\u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c", "\u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e", "salvar", "salvo", "salva", "salvato", "opslaan", "opgeslagen", "zapisz", "zapisano", "kaydet", "kaydedildi", "\u0938\u0939\u0947\u091c\u0947\u0902", "\u4fdd\u5b58", "\u5132\u5b58", "\u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438", "\u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e", "\u0630\u062e\u06cc\u0631\u0647", "simpan", "disimpan", "ulo\u017eit", "ulo\u017eeno", "salveaz", "salvat", "ment\u00e9s", "mentve", "\u03b1\u03c0\u03bf\u03b8\u03ae\u03ba\u03b5\u03c5\u03c3\u03b7", "spara", "sparad", "gem", "gemt", "tallenna", "tallennettu", "lagre", "lagret", "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01", "l\u01b0u"];
const YOOD_SHARE_WORDS = ["share", "\u05e9\u05d9\u05ea\u05d5\u05e3", "\u05e9\u05ea\u05e3", "\u0645\u0634\u0627\u0631\u0643\u0629", "compartir", "partager", "teilen", "\u043f\u043e\u0434\u0435\u043b\u0438\u0442\u044c\u0441\u044f", "compartilhar", "partilhar", "condividi", "delen", "udost\u0119pnij", "payla\u015f", "\u0936\u0947\u092f\u0930", "\u5171\u6709", "\uacf5\uc720", "\u5206\u4eab", "\u043f\u043e\u0434\u0456\u043b\u0438\u0442\u0438\u0441\u044f", "bagikan"];
const YOOD_MORE_WORDS = ["more actions", "additional actions", "\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05e0\u05d5\u05e1\u05e4\u05d5\u05ea", "\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0625\u0636\u0627\u0641\u064a\u0629", "m\u00e1s acciones", "plus d\u0027actions", "weitere aktionen", "\u0434\u0440\u0443\u0433\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f", "mais a\u00e7\u00f5es", "altre azioni", "meer acties", "wi\u0119cej dzia\u0142a\u0144", "di\u011fer \u0131\u015flemler", "\u305d\u306e\u4ed6\u306e\u64cd\u4f5c", "\ucd94\uac00 \uc791\uc5c5", "\u66f4\u591a\u64cd\u4f5c", "\u0456\u043d\u0448\u0456 \u0434\u0456\u0457"];
function yoodFindActionAnchor(host) {
    try {
        const kids = Array.from(host.children).filter((k) => k instanceof Element && !k.hasAttribute("data-yood-download") && !k.hasAttribute("data-yood-watch-later") && !k.hasAttribute("data-yood-main-download") && !k.hasAttribute("data-yood-main-action"));
        if (!kids.length)
            return null;
        const combined = (el) => {
            try {
                return (((el.textContent || "") + " " + (el.getAttribute("aria-label") || "")).trim().toLowerCase());
            }
            catch {
                return "";
            }
        };
        const isOverflow = (el) => {
            try {
                if (el.tagName.toLowerCase() === "ytd-menu-renderer")
                    return true;
                const aria = (el.getAttribute("aria-label") || "").toLowerCase();
                for (const w of YOOD_MORE_WORDS)
                    if (w && aria && aria.includes(w))
                        return true;
                if (el.querySelector && el.querySelector("ytd-menu-renderer"))
                    return true;
            }
            catch { }
            return false;
        };
        const isSave = (el) => {
            const s = combined(el);
            if (!s)
                return false;
            return YOOD_SAVE_WORDS.some((w) => w && s.includes(w));
        };
        const isShare = (el) => {
            const s = combined(el);
            if (!s)
                return false;
            return YOOD_SHARE_WORDS.some((w) => w && s.includes(w));
        };
        let overflowIdx = -1, saveIdx = -1, shareIdx = -1;
        kids.forEach((k, i) => {
            if (overflowIdx === -1 && isOverflow(k))
                overflowIdx = i;
            if (saveIdx === -1 && isSave(k))
                saveIdx = i;
            if (shareIdx === -1 && isShare(k))
                shareIdx = i;
        });
        // A single wrapper matching BOTH is an outer container, not a button.
        if (saveIdx !== -1 && saveIdx === shareIdx) {
            saveIdx = -1;
            shareIdx = -1;
        }
        if (saveIdx !== -1 && shareIdx !== -1)
            return kids[Math.max(saveIdx, shareIdx)] ?? null;
        if (saveIdx !== -1)
            return kids[saveIdx] ?? null;
        if (shareIdx !== -1)
            return kids[shareIdx + 1] ?? null;
        if (overflowIdx !== -1) {
            if (overflowIdx >= 2)
                return kids[overflowIdx - 1] ?? kids[overflowIdx] ?? null;
            return kids[overflowIdx] ?? null;
        }
        return null;
    }
    catch {
        return null;
    }
}
// YouTube owns the rest of the document theme.  Restrict Yood's override to
// the documented root attribute and colour-scheme hint; changing several
// legacy attributes makes YouTube's own theme controller repeatedly rebuild
// its UI on some WebKit versions.
const THEME_SETTLE_DELAYS = [160, 1100];
function effectiveAppearance(appearance) {
    return appearance === "system"
        ? (detectedSystemAppearance ?? (systemAppearance?.matches ? "dark" : "light"))
        : appearance;
}
function clearAppearanceTimers() {
    appearanceTimers.forEach((timer) => window.clearTimeout(timer));
    appearanceTimers = [];
}
function applyEffectiveAppearance() {
    const effective = effectiveAppearance(selectedAppearance);
    const dark = effective === "dark";
    const root = document.documentElement;
    if (!root)
        return;
    root.style.setProperty("color-scheme", effective, "important");
    // This is the attribute YouTube uses for its colour variables.  Do not
    // modify body classes or YouTube's legacy theme attributes: doing so causes
    // its asynchronous theme code to fight the integration layer.
    root.toggleAttribute("dark", dark);
    let style = document.getElementById("yood-theme-style");
    if (!style && document.head) {
        style = document.createElement("style");
        style.id = "yood-theme-style";
        document.head.appendChild(style);
    }
    if (style) {
        const background = dark ? "#0f0f0f" : "#fff";
        style.textContent = `:root { color-scheme: ${effective} !important; background-color: ${background} !important; }`;
    }
}
function stabilizeAppearance() {
    clearAppearanceTimers();
    applyEffectiveAppearance();
    // YouTube applies its saved preference shortly after a navigation.  A
    // bounded pair of follow-up writes wins that initial race without a
    // perpetual MutationObserver loop or background work while the page idles.
    appearanceTimers = THEME_SETTLE_DELAYS.map((delay) => window.setTimeout(() => {
        applyEffectiveAppearance();
    }, delay));
}
function applyAppearance(appearance, userInitiated = false) {
    if (userInitiated)
        appearanceRevision += 1;
    selectedAppearance = appearance;
    const root = document.documentElement;
    if (!root) {
        window.addEventListener("DOMContentLoaded", () => applyAppearance(appearance), { once: true });
        return;
    }
    stabilizeAppearance();
}
function installAppearance() {
    systemAppearance ?? (systemAppearance = window.matchMedia("(prefers-color-scheme: dark)"));
    detectedSystemAppearance = systemAppearance.matches ? "dark" : "light";
    applyAppearance("system");
    systemAppearance.addEventListener("change", () => {
        detectedSystemAppearance = systemAppearance?.matches ? "dark" : "light";
        if (selectedAppearance === "system")
            applyAppearance("system");
    });
    const reapply = () => applyAppearance(selectedAppearance);
    window.addEventListener("DOMContentLoaded", reapply, { once: true });
    window.addEventListener("yt-navigate-finish", reapply);
    window.addEventListener("yt-page-data-updated", reapply);
    void invoke("get_system_appearance").then((appearance) => {
        if (appearance === "dark" || appearance === "light") {
            detectedSystemAppearance = appearance;
            if (selectedAppearance === "system")
                applyAppearance("system");
        }
    }).catch(() => undefined);
    const settingsRequestRevision = appearanceRevision;
    void invoke("get_settings").then((settings) => {
        const appearance = settings.appearance;
        if (appearanceRevision === settingsRequestRevision && (appearance === "light" || appearance === "dark" || appearance === "system")) {
            applyAppearance(appearance);
        }
    }).catch(() => undefined);
}
const css = `
#yood-root { font-family: Roboto, Arial, sans-serif; color-scheme: light dark; }
#yood-root button { font: inherit; }
.yood-download-button { border: 0; border-radius: 18px; padding: 8px 14px; margin: 4px; color: #f1f1f1; background: #272727; cursor: pointer; font-weight: 500; }
.yood-download-button:hover { background: #3f3f3f; }
.yood-download-button[aria-busy=true] { opacity: .65; }
.yood-native-player-button { border: 1px solid #3ea6ff; border-radius: 18px; padding: 8px 14px; margin: 4px; color: #3ea6ff; background: transparent; cursor: pointer; font-weight: 500; }
.yood-native-player-button:hover { background: #263850; }
.yood-video-actions-fallback { position: fixed; left: 16px; bottom: 68px; z-index: 2147483640; display: flex; gap: 6px; align-items: center; padding: 5px; border: 1px solid #444; border-radius: 22px; background: #181818e8; box-shadow: 0 4px 16px #0008; }
#yood-navigation { position: fixed; left: 16px; bottom: 16px; z-index: 2147483640; display: flex; gap: 4px; padding: 5px; border: 1px solid #444; border-radius: 22px; background: #181818e8; box-shadow: 0 4px 16px #0008; direction: ltr; }
#yood-navigation button { width: 34px; height: 34px; border: 0; border-radius: 17px; color: #f1f1f1; background: transparent; font-size: 20px; cursor: pointer; }
#yood-navigation button.yood-url-button { width: auto; font-size: 11px; font-weight: 600; letter-spacing: .04em; padding: 0 7px; border-radius: 12px; color: #8ab4f8; }
#yood-navigation button:hover { background: #3f3f3f; }
/* Tiling compositors (Hyprland, niri) draw no window decorations, so Yood's
   own floating controls stay tucked at the bottom edge and never mimic a
   title bar.  Plasma/GNOME keep the standard placement next to their native
   decorations. */
:root[data-yood-desktop="hyprland"] #yood-navigation,
:root[data-yood-desktop="niri"] #yood-navigation,
:root[data-yood-desktop="hyprland"] #yood-dock,
:root[data-yood-desktop="niri"] #yood-dock { left: 12px; bottom: 12px; opacity: .92; }
.yood-overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(0,0,0,.58); display: flex; align-items: center; justify-content: center; }
.yood-card { width: min(520px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 32px)); overflow: auto; background: #212121; color: #f1f1f1; border: 1px solid #444; border-radius: 14px; box-shadow: 0 12px 48px #000b; padding: 20px; }
.yood-card h2 { font-size: 20px; margin: 0 0 16px; }
.yood-card h3 { font-size: 14px; margin: 18px 0 8px; }
.yood-row { display: flex; gap: 10px; align-items: center; margin: 9px 0; }
.yood-row label { flex: 1; }
.yood-row:has(> button[id$="-browse"]) label { flex: 0 1 auto; }
.yood-row:has(> button[id$="-browse"]) input { flex: 1 1 0; min-width: 0; max-width: none; }
.yood-card select, .yood-card input { color: inherit; background: #303030; border: 1px solid #666; border-radius: 6px; padding: 8px; max-width: 100%; }
.yood-card input[type=text] { width: 100%; box-sizing: border-box; }
.yood-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.yood-primary { border: 0; border-radius: 18px; padding: 9px 18px; color: #fff; background: #065fd4; cursor: pointer; }
.yood-secondary { border: 1px solid #666; border-radius: 18px; padding: 8px 16px; color: inherit; background: transparent; cursor: pointer; }
.yood-muted { color: #aaa; font-size: 12px; }
#yood-urlbar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647; display: flex; gap: 10px; align-items: center; padding: 10px 14px; background: #171717f2; border-bottom: 1px solid #444; box-shadow: 0 4px 24px #000a; backdrop-filter: blur(10px); transform: translateY(-100%); animation: yood-urlbar-in .3s cubic-bezier(.2,.9,.3,1.18) forwards; }
@keyframes yood-urlbar-in { from { transform: translateY(-100%); opacity: .3; } to { transform: translateY(0); opacity: 1; } }
#yood-urlbar .yood-urlbar-logo { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #ff0000; color: #fff; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px #f004; }
#yood-urlbar input { flex: 1; min-width: 0; color: #f1f1f1; background: #0000; border: 1px solid #555; border-radius: 10px; padding: 9px 12px; font-size: 14px; outline: none; transition: border-color .15s, box-shadow .15s; }
#yood-urlbar input:focus { border-color: #3ea6ff; box-shadow: 0 0 0 2px #3ea6ff44; }
#yood-urlbar.yood-urlbar-loading input { pointer-events: none; animation: yood-urlbar-glow .9s ease-in-out infinite; }
#yood-urlbar.yood-urlbar-loading .yood-urlbar-go { animation: yood-urlbar-pulse .9s ease-in-out infinite; }
@keyframes yood-urlbar-glow { 0%,100% { border-color: #3ea6ff; box-shadow: 0 0 0 2px #3ea6ff44; } 50% { border-color: #9a6cff; box-shadow: 0 0 14px 2px #3ea6ff99; } }
@keyframes yood-urlbar-pulse { 0%,100% { background: #3ea6ff; } 50% { background: #6b7cff; box-shadow: 0 0 14px #3ea6ff99; } }
#yood-urlbar.yood-urlbar-shake { animation: yood-urlbar-shake .42s ease; }
@keyframes yood-urlbar-shake { 0%,100% { transform: translateY(0); } 20% { transform: translateY(5px); } 40% { transform: translateY(-5px); } 60% { transform: translateY(3px); } 80% { transform: translateY(-2px); } }
.yood-urlbar-close { flex: none; width: 30px; height: 30px; border: 0; border-radius: 50%; color: #eee; background: #ffffff14; cursor: pointer; font-size: 16px; line-height: 1; }
.yood-urlbar-close:hover { background: #ffffff2e; }
#yood-urlbar .yood-urlbar-error { position: absolute; top: calc(100% + 8px); left: 16px; color: #f28b82; font-size: 12px; background: #000c; border: 1px solid #5c2b2b; border-radius: 8px; padding: 6px 10px; box-shadow: 0 4px 14px #000a; }
.yood-entry { display: flex; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid #383838; }
.yood-entry label { flex: 1; font-size: 13px; }
.yood-progress { height: 5px; background: #444; border-radius: 4px; overflow: hidden; margin-top: 4px; }
.yood-progress > i { display: block; height: 100%; background: #3ea6ff; }
#yood-dock { position: fixed; right: 18px; bottom: 18px; z-index: 2147483640; display: flex; gap: 6px; align-items: center; }
#yood-dock button { border: 0; border-radius: 22px; height: 40px; padding: 0 16px; color: #fff; background: #065fd4; box-shadow: 0 4px 16px #0008; cursor: pointer; font-weight: 500; }
#yood-dock button:hover { filter: brightness(1.12); }
#yood-dock .yood-dock-badge { display: inline-block; min-width: 18px; height: 18px; line-height: 18px; margin-left: 6px; padding: 0 5px; border-radius: 9px; background: #ff0000; color: #fff; font-size: 11px; font-weight: 700; text-align: center; box-sizing: border-box; }
#yood-dock .yood-dock-badge[hidden] { display: none; }
#yood-download-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 84px; z-index: 2147483641; display: flex; gap: 10px; align-items: center; padding: 8px 14px; border: 1px solid #444; border-radius: 22px; background: #181818e8; box-shadow: 0 4px 16px #0008; font-size: 13px; cursor: pointer; }
#yood-download-bar:hover { background: #272727; }
#yood-download-bar .yood-bar-progress { width: 90px; height: 5px; background: #444; border-radius: 4px; overflow: hidden; flex: none; }
#yood-download-bar .yood-bar-progress > i { display: block; height: 100%; background: #3ea6ff; transition: width .3s; }
.yood-watch-later-button { border: 1px solid #5f5f5f; border-radius: 18px; padding: 8px 14px; margin: 4px; color: #e8e8e8; background: #1f1f1f; cursor: pointer; font-weight: 500; }
.yood-watch-later-button:hover { background: #2f2f2f; }
.yood-watch-later-button.yood-watch-later-saved { border: 0; background: #168aca; color: #fff; }
.yood-watch-later-button.yood-watch-later-saved:hover { background: #2b99d8; }
#yood-later { position: relative; }
#yood-later .yood-dock-badge { position: absolute; top: -5px; right: -5px; margin: 0; }
#yood-watch-later-panel { position: fixed; right: 18px; bottom: 68px; z-index: 2147483642; width: min(340px, calc(100vw - 32px)); max-height: min(420px, calc(100vh - 120px)); overflow-y: auto; background: #181818f5; color: #f1f1f1; border: 1px solid #444; border-radius: 14px; box-shadow: 0 12px 40px #000a; font-size: 13px; }
#yood-watch-later-panel[hidden] { display: none; }
.yood-watch-later-title { display: flex; align-items: center; gap: 8px; padding: 12px 8px 8px 14px; font-weight: 600; }
.yood-watch-later-clear { margin-left: auto; flex: none; border: 1px solid #555; border-radius: 14px; padding: 4px 10px; color: inherit; background: transparent; cursor: pointer; font-size: 12px; }
.yood-watch-later-clear:hover { background: #262626; }
.yood-watch-later-item { display: flex; gap: 10px; align-items: center; padding: 8px 8px 8px 14px; border-top: 1px solid #2b2b2b; cursor: pointer; }
.yood-watch-later-item:hover { background: #242424; }
.yood-watch-later-item .yood-wl-thumb { flex: none; width: 96px; height: 54px; object-fit: cover; border-radius: 8px; background: #000; }
.yood-watch-later-item .yood-wl-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.yood-watch-later-item .yood-wl-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.yood-watch-later-item .yood-muted { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.yood-watch-later-remove { flex: none; width: 26px; height: 26px; border: 0; border-radius: 50%; color: #bbb; background: transparent; cursor: pointer; font-size: 13px; line-height: 1; }
.yood-watch-later-remove:hover { background: #3a3a3a; color: #fff; }
.yood-watch-later-empty { padding: 18px 14px; color: #aaa; text-align: center; }
.yood-drop-hot { outline: 2px solid #3ea6ff !important; outline-offset: 2px; }
:root[data-yood-desktop="hyprland"] #yood-watch-later-panel,
:root[data-yood-desktop="niri"] #yood-watch-later-panel { right: auto; left: 12px; }
#yood-toast { position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%); z-index: 2147483647; background: #292929; color: #fff; padding: 11px 16px; border-radius: 6px; box-shadow: 0 3px 12px #0008; }
#yood-auth-fallback { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 2147483640; display: flex; gap: 10px; align-items: center; padding: 10px 14px; border: 1px solid #444; border-radius: 12px; background: #181818e8; box-shadow: 0 4px 16px #0008; font-size: 13px; max-width: min(560px, calc(100vw - 32px)); }
#yood-auth-fallback span { flex: 1; }
#yood-auth-fallback button { flex: none; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; } }
`;
function ensureRoot() {
    let root = document.getElementById("yood-root");
    if (!document.head || !document.body)
        return document.documentElement;
    if (!root) {
        const style = document.createElement("style");
        style.id = "yood-style";
        style.textContent = css;
        document.head.appendChild(style);
        root = document.createElement("div");
        root.id = "yood-root";
        document.body.appendChild(root);
    }
    return root;
}
function currentUrl() { return window.location.href; }
// Accepts only YouTube URLs, matching the host allow-list the Rust side
// uses for its own navigation checks. Bare video IDs and youtu.be short
// links are normalised to a full watch URL.
function parseYoutubeUrlInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url;
    try {
        url = new URL(candidate);
    }
    catch {
        return null;
    }
    if (url.protocol !== "https:")
        return null;
    const host = url.hostname.toLowerCase();
    const allowedHosts = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
    if (host === "youtu.be") {
        const id = url.pathname.slice(1).split("/")[0];
        return id ? `https://www.youtube.com/watch?v=${id}${url.search}` : null;
    }
    if (allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
        return url.href;
    }
    return null;
}
function showUrlBar() {
    const existing = document.getElementById("yood-urlbar");
    if (existing) {
        existing.remove();
        return;
    }
    closeOverlay();
    const bar = document.createElement("div");
    bar.id = "yood-urlbar";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Open YouTube link");
    const logo = document.createElement("span");
    logo.className = "yood-urlbar-logo";
    logo.textContent = "Y";
    logo.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Paste a YouTube video, shorts, or channel link…";
    input.autocomplete = "off";
    input.spellcheck = false;
    const go = button("Go", true);
    go.className = "yood-primary yood-urlbar-go";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "yood-urlbar-close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close");
    const error = document.createElement("div");
    error.className = "yood-urlbar-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    bar.append(logo, input, go, close, error);
    document.body.appendChild(bar);
    const closeBar = () => bar.remove();
    close.addEventListener("click", closeBar);
    const showError = (message) => {
        error.textContent = message;
        error.hidden = false;
        bar.classList.remove("yood-urlbar-shake");
        void bar.offsetWidth;
        bar.classList.add("yood-urlbar-shake");
    };
    const clearError = () => {
        error.hidden = true;
        bar.classList.remove("yood-urlbar-shake");
    };
    const submit = () => {
        const destination = parseYoutubeUrlInput(input.value);
        if (!destination) {
            showError("This link isn't a YouTube link.");
            return;
        }
        clearError();
        bar.classList.add("yood-urlbar-loading");
        input.disabled = true;
        go.disabled = true;
        window.setTimeout(() => {
            bar.remove();
            window.location.href = destination;
        }, 420);
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            submit();
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closeBar();
        }
    });
    input.addEventListener("input", clearError);
    window.setTimeout(() => input.focus(), 0);
}
function videoUrlFrom(element) {
    const link = element.querySelector('a[href*="/watch?v="], a[href*="/shorts/"], a[href*="/live/"], a[href*="youtu.be/"]');
    if (!link)
        return null;
    try {
        const url = new URL(link.href, location.href);
        if (url.hostname === "youtu.be")
            return `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`;
        return url.href;
    }
    catch {
        return null;
    }
}
function textFrom(element, selectors) {
    for (const selector of selectors) {
        const node = element.querySelector(selector);
        const text = node?.textContent?.trim();
        if (text)
            return text;
    }
    return "";
}
function entryFromElement(element) {
    const url = videoUrlFrom(element);
    if (!url)
        return null;
    const parsed = new URL(url);
    const id = parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || url;
    let title = textFrom(element, ["#video-title", "a#video-title", "yt-formatted-string", ".yt-lockup-metadata-view-model__title"]);
    if (!title) {
        const link = element.querySelector('a[href*="/watch"], a[href*="/shorts/"], a[href*="youtu.be/"]');
        title = link?.getAttribute("aria-label")?.trim() || link?.getAttribute("title")?.trim() || "";
    }
    let channel = textFrom(element, ["#channel-name", "ytd-channel-name", ".ytd-channel-name"]);
    if (!channel) {
        const cn = element.querySelector('a[href*="/channel/"], a[href^="/@"], a[href*="youtube.com/@"]');
        channel = cn?.textContent?.trim() || "";
    }
    return { id, url, title, channel };
}
function makeButton(url, context, title = "Download") {
    const button = document.createElement("button");
    button.className = "yood-download-button";
    button.dataset.yoodDownload = url;
    button.dataset.yoodContext = context;
    button.type = "button";
    try {
        button.setAttribute("aria-label", yoodT("downloadWith"));
        button.title = yoodT("downloadWith");
    }
    catch {
        button.setAttribute("aria-label", `${title} with Yood`);
    }
    try {
        button.textContent = `\u2193 ${yoodT("downloadWith")}`;
    }
    catch {
        button.textContent = "↓ Download with Yood";
    }
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (context === "playlist" || context === "channel")
            void showPlaylistDialog(url, context);
        else
            showDownloadDialog(url, context);
    });
    return button;
}
function makeNativePlayerButton(url, title) {
    const button = document.createElement("button");
    button.className = "yood-native-player-button";
    button.type = "button";
    button.dataset.yoodNativePlayer = url;
    button.setAttribute("aria-label", "Play this video in Yood Native Player");
    button.textContent = "▶ Yood Player";
    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try {
            await invoke("open_native_player_url", { url, title });
            toast("Opening Yood Native Player");
        }
        catch (error) {
            toast(`Could not open Yood Player: ${String(error)}`);
        }
        finally {
            button.disabled = false;
        }
    });
    return button;
}
function injectCardButton(card) {
    if (card.querySelector("[data-yood-download]"))
        return;
    const entry = entryFromElement(card);
    if (!entry)
        return;
    const host = card.querySelector("#menu, #buttons, #top-level-buttons-computed, #menu-container") || card;
    host.appendChild(makeButton(entry.url, "video", entry.title || "Download"));
}
function injectVideoButton() {
    const url = currentUrl();
    const collection = /youtube\.com\/playlist\?[^#]*list=/i.test(url) ? "playlist" : /youtube\.com\/(channel\/|c\/|@)/i.test(url) || /(^|\.)music\.youtube\.com$/i.test(location.hostname) ? "channel" : "video";
    if (!/youtube\.com\/(watch|shorts\/|live\/|playlist|channel\/|c\/|@)/i.test(url))
        return;
    const existing = document.querySelector("[data-yood-main-download]");
    if (existing?.dataset.yoodDownload === url && existing.isConnected)
        return;
    document.querySelectorAll("[data-yood-main-action]").forEach((node) => node.remove());
    document.getElementById("yood-video-actions-fallback")?.remove();
    const depthOf = (el) => {
        let d = 0;
        try {
            let n = el;
            while (n?.parentNode) {
                d++;
                n = n.parentNode;
            }
        }
        catch { /* depth stays */ }
        return d;
    };
    const pickDeepestVisible = (selector) => {
        const all = Array.from(document.querySelectorAll(selector)).filter((c) => c instanceof Element);
        if (!all.length)
            return null;
        const visible = all.filter((c) => {
            if (c.closest("[hidden]"))
                return false;
            try {
                const r = c.getBoundingClientRect();
                if (!(r.width > 40 && r.height > 0))
                    return false;
            }
            catch {
                return false;
            }
            // Skip containers wrapping another candidate row.
            return !all.some((o) => o !== c && c.contains(o));
        });
        const pool = visible.length ? visible : all.filter((c) => c instanceof Element && !c.closest("[hidden]"));
        if (!pool.length)
            return all[0] ?? null;
        return pool.reduce((a, b) => (depthOf(b) > depthOf(a) ? b : a));
    };
    let host = pickDeepestVisible("ytd-watch-metadata #top-level-buttons-computed, #top-level-buttons-computed, ytd-watch-metadata #actions-inner, ytd-watch-metadata #actions, ytd-reel-player-overlay-renderer #actions, ytd-shorts #actions, ytd-reel-video-renderer #actions, ytd-reel-player-header-renderer #actions, #top-level-buttons, ytd-menu-renderer #menu");
    if (!host && (collection === "playlist" || collection === "channel")) {
        const candidates = document.querySelectorAll("ytd-playlist-header-renderer #actions, ytd-playlist-sidebar-primary-info-renderer #actions, ytd-c4-tabbed-header-renderer #actions, ytd-browse #header #actions");
        for (const c of candidates) {
            if (!(c instanceof Element) || !c.isConnected)
                continue;
            if (c.closest("[hidden]"))
                continue;
            try {
                const r = c.getBoundingClientRect();
                if (r.width > 40 && r.height > 0) {
                    host = c;
                    break;
                }
                if (!host)
                    host = c;
            }
            catch { /* next */ }
        }
    }
    document.querySelectorAll("ytd-download-button-renderer").forEach((node) => {
        node.style.display = "none";
    });
    const button = makeButton(url, collection);
    button.dataset.yoodMainDownload = "true";
    button.dataset.yoodMainAction = "true";
    const player = collection === "video" ? makeNativePlayerButton(url, document.title.replace(/ - YouTube$/, "")) : null;
    if (player)
        player.dataset.yoodMainAction = "true";
    const later = collection === "video" ? makeWatchLaterChip(url) : null;
    if (later)
        later.dataset.yoodMainAction = "true";
    if (host) {
        // Sit BETWEEN Save and Share (never after the ⋮ overflow menu).
        // yoodFindActionAnchor is multilingual + positional so the pill lands in
        // the exact requested slot in every YouTube UI language.
        let anchor = null;
        try {
            anchor = yoodFindActionAnchor(host);
        }
        catch {
            anchor = null;
        }
        if (!anchor) {
            const overflow = host.querySelector(":scope > ytd-menu-renderer, ytd-menu-renderer");
            anchor = overflow && overflow.parentNode === host ? overflow : null;
        }
        host.insertBefore(button, anchor);
        if (later)
            host.insertBefore(later, anchor);
        if (player)
            host.insertBefore(player, anchor);
        return;
    }
    // Some YouTube deployments defer their action menu or omit it on Shorts.
    // Keep the functionality available rather than leaving the page without the
    // mandatory Yood controls.
    const fallback = document.createElement("div");
    fallback.id = "yood-video-actions-fallback";
    fallback.className = "yood-video-actions-fallback";
    fallback.dataset.yoodMainAction = "true";
    fallback.append(button);
    if (later)
        fallback.appendChild(later);
    if (player)
        fallback.appendChild(player);
    document.body?.appendChild(fallback);
}
function ensureNavigation() {
    if (!document.body || document.getElementById("yood-navigation"))
        return;
    const navigation = document.createElement("nav");
    navigation.id = "yood-navigation";
    navigation.setAttribute("aria-label", "Yood navigation");
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "←";
    back.title = "Back";
    back.setAttribute("aria-label", "Back");
    back.addEventListener("click", () => window.history.back());
    const forward = document.createElement("button");
    forward.type = "button";
    forward.textContent = "→";
    forward.title = "Forward";
    forward.setAttribute("aria-label", "Forward");
    forward.addEventListener("click", () => window.history.forward());
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "⟳";
    reload.title = "Reload";
    reload.setAttribute("aria-label", "Reload");
    reload.addEventListener("click", () => window.location.reload());
    const url = document.createElement("button");
    url.type = "button";
    url.id = "yood-url-button";
    url.className = "yood-url-button";
    url.textContent = "URL";
    url.title = "Open a YouTube link (Ctrl+L)";
    url.setAttribute("aria-label", "Open YouTube link");
    navigation.append(back, forward, reload, url);
    document.body.appendChild(navigation);
}
function refreshDownloadLabels() {
    document.querySelectorAll("[data-yood-download]").forEach((btn) => {
        try {
            const want = `\u2193 ${yoodT("downloadWith")}`;
            if (btn.textContent !== want)
                btn.textContent = want;
            btn.setAttribute("aria-label", yoodT("downloadWith"));
        }
        catch { /* keep */ }
    });
}
function scan() {
    ensureRoot();
    try {
        refreshDownloadLabels();
    }
    catch { /* keep */ }
    if (document.querySelector("ytd-app, ytd-page-manager"))
        window.__YOOD_BOOT__?.complete();
    document.querySelectorAll("ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer").forEach(injectCardButton);
    injectVideoButton();
    ensureNavigation();
    ensureLauncher();
    ensureDownloadBar();
    ensureWatchLaterPanel();
    updateWatchLaterUI();
}
const SCANNABLE_CARD_SELECTOR = "ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ytd-reel-item-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytmusic-responsive-list-item-renderer, ytmusic-player-queue-item";
function needsCardScan(node) {
    return node instanceof Element
        && (node.matches(SCANNABLE_CARD_SELECTOR) || Boolean(node.querySelector(SCANNABLE_CARD_SELECTOR)));
}
function toast(message) {
    document.getElementById("yood-toast")?.remove();
    const node = document.createElement("div");
    node.id = "yood-toast";
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
}
let closeManagerLive;
function closeOverlay() {
    closeManagerLive?.();
    closeManagerLive = undefined;
    document.querySelector(".yood-overlay")?.remove();
    document.getElementById("yood-urlbar")?.remove();
}
function button(label, primary = false) {
    const result = document.createElement("button");
    result.type = "button";
    result.textContent = label;
    result.className = primary ? "yood-primary" : "yood-secondary";
    return result;
}
function showDownloadDialog(url, context) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "yood-overlay";
    const card = document.createElement("section");
    card.className = "yood-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.innerHTML = `<h2>Download with Yood</h2><div class="yood-muted">${escapeHtml(document.title.replace(/ - YouTube$/, ""))}</div>`;
    const modeRow = document.createElement("div");
    modeRow.className = "yood-row";
    modeRow.innerHTML = `<label for="yood-mode">Mode</label><select id="yood-mode"><option value="video">Video</option><option value="audio">Audio (MP3)</option><option value="songs">Songs (MP3 + metadata)</option></select>`;
    const qualityRow = document.createElement("div");
    qualityRow.className = "yood-row";
    qualityRow.innerHTML = `<label for="yood-quality">Quality</label><select id="yood-quality"><option value="best">Best available</option><option value="1080">1080p or best</option><option value="720">720p or best</option><option value="480">480p or best</option><option value="worst">Smallest available</option></select>`;
    const containerRow = document.createElement("div");
    containerRow.className = "yood-row";
    containerRow.innerHTML = `<label for="yood-container">Container</label><select id="yood-container"><option value="mp4">MP4</option><option value="mkv">MKV</option></select>`;
    const locationRow = document.createElement("div");
    locationRow.className = "yood-row";
    locationRow.innerHTML = `<label for="yood-download-folder">Save to</label><input id="yood-download-folder" type="text" placeholder="Loading…"><button id="yood-download-folder-browse" type="button" class="yood-secondary">Browse…</button>`;
    const browse = locationRow.querySelector("#yood-download-folder-browse");
    browse?.addEventListener("click", async () => {
        browse.disabled = true;
        try {
            const folder = await invoke("pick_folder");
            if (folder)
                locationRow.querySelector("#yood-download-folder").value = folder;
        }
        catch (error) {
            toast(`Could not pick folder: ${String(error)}`);
        }
        finally {
            browse.disabled = false;
        }
    });
    void invoke("get_settings_for_ui").then((settings) => {
        const value = settings.download_directory;
        const input = locationRow.querySelector("#yood-download-folder");
        if (typeof value === "string" && input && input.value === "")
            input.value = value;
    }).catch(() => undefined);
    const advanced = document.createElement("details");
    advanced.innerHTML = `<summary>Advanced</summary><div class="yood-row"><label for="yood-format">yt-dlp format selector</label><input id="yood-format" type="text" placeholder="optional"></div><div class="yood-row"><label><input id="yood-subs" type="checkbox"> Download subtitles</label></div><div class="yood-row"><label><input id="yood-thumb" type="checkbox"> Embed thumbnail and metadata</label></div>`;
    const actions = document.createElement("div");
    actions.className = "yood-actions";
    const cancel = button("Cancel");
    cancel.addEventListener("click", closeOverlay);
    const start = button("Download", true);
    start.addEventListener("click", async () => {
        start.disabled = true;
        try {
            const mode = card.querySelector("#yood-mode").value;
            const directory = card.querySelector("#yood-download-folder").value.trim();
            await invoke("enqueue_download", {
                request: {
                    url, mode, quality: card.querySelector("#yood-quality").value,
                    container: card.querySelector("#yood-container").value,
                    format_selector: card.querySelector("#yood-format").value || undefined,
                    subtitles: card.querySelector("#yood-subs").checked,
                    embed_thumbnail: card.querySelector("#yood-thumb").checked || mode === "songs",
                    context,
                    directory: directory || undefined,
                }
            });
            closeOverlay();
            toast("Added to Yood's download queue");
        }
        catch (error) {
            toast(`Could not queue download: ${String(error)}`);
            start.disabled = false;
        }
    });
    actions.append(cancel, start);
    card.append(modeRow, qualityRow, containerRow, locationRow, advanced, actions);
    overlay.appendChild(card);
    overlay.addEventListener("click", (event) => { if (event.target === overlay)
        closeOverlay(); });
    document.body.appendChild(overlay);
    card.querySelector("#yood-mode").addEventListener("change", (event) => {
        const audio = event.target.value !== "video";
        card.querySelector("#yood-quality").disabled = audio;
        card.querySelector("#yood-container").disabled = audio;
    });
}
async function showPlaylistDialog(url, kind) {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "yood-overlay";
    const card = document.createElement("section");
    card.className = "yood-card";
    card.innerHTML = `<h2>${kind === "playlist" ? "Playlist" : "Channel"} download</h2><p class="yood-muted">Loading available videos…</p>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try {
        const result = await invoke("inspect_url", { url });
        const entries = result.entries || [];
        try {
            const plTitle = escapeHtml(`${yoodT("playlistTitle")} — ${result.title || (kind === "playlist" ? "Playlist" : "Channel")}`);
            const plSub = escapeHtml(yoodT("playlistConfirm").split("{n}").join(String(entries.length)));
            card.innerHTML = `<h2>${plTitle}</h2><p class="yood-muted">${plSub}</p>`;
        }
        catch {
            card.innerHTML = `<h2>${escapeHtml(result.title || (kind === "playlist" ? "Playlist" : "Channel"))}</h2>`;
        }
        const selectActions = document.createElement("div");
        selectActions.className = "yood-actions";
        const selectAll = button("Select all");
        const selectNone = button("Deselect all");
        const list = document.createElement("div");
        entries.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "yood-entry";
            row.innerHTML = `<input type="checkbox" checked data-yood-entry="${escapeHtml(entry.url)}"><label>${escapeHtml(entry.title || entry.id)}<span class="yood-muted">${escapeHtml(entry.channel || "")}</span></label>`;
            list.appendChild(row);
        });
        selectAll.addEventListener("click", () => list.querySelectorAll("input").forEach((input) => input.checked = true));
        selectNone.addEventListener("click", () => list.querySelectorAll("input").forEach((input) => input.checked = false));
        selectActions.append(selectAll, selectNone);
        card.append(selectActions, list);
        const options = document.createElement("div");
        options.innerHTML = `<h3>Download options</h3><div class="yood-row"><label>Mode</label><select id="yood-list-mode"><option value="video">Video</option><option value="audio">Audio (MP3)</option><option value="songs">Songs (MP3 + metadata)</option></select></div><div class="yood-row"><label>Quality</label><select id="yood-list-quality"><option value="best">Best available</option><option value="1080">1080p or best</option><option value="720">720p or best</option><option value="480">480p or best</option></select></div><div class="yood-row"><label for="yood-list-folder">Save to</label><input id="yood-list-folder" type="text" placeholder="Loading…"><button id="yood-list-folder-browse" type="button" class="yood-secondary">Browse…</button></div>`;
        const browseListFolder = options.querySelector("#yood-list-folder-browse");
        browseListFolder?.addEventListener("click", async () => {
            browseListFolder.disabled = true;
            try {
                const folder = await invoke("pick_folder");
                if (folder)
                    options.querySelector("#yood-list-folder").value = folder;
            }
            catch (error) {
                toast(`Could not pick folder: ${String(error)}`);
            }
            finally {
                browseListFolder.disabled = false;
            }
        });
        void invoke("get_settings_for_ui").then((settings) => {
            const value = settings.download_directory;
            const input = options.querySelector("#yood-list-folder");
            if (typeof value === "string" && input && input.value === "")
                input.value = value;
        }).catch(() => undefined);
        card.appendChild(options);
        const actions = document.createElement("div");
        actions.className = "yood-actions";
        const cancel = button("Cancel");
        cancel.addEventListener("click", closeOverlay);
        const start = button("Download selected", true);
        start.addEventListener("click", async () => {
            const selected = [...list.querySelectorAll("input:checked")].map((input) => input.dataset.yoodEntry).filter((x) => Boolean(x));
            if (!selected.length)
                return toast("Select at least one video");
            start.disabled = true;
            try {
                const mode = card.querySelector("#yood-list-mode").value;
                const quality = card.querySelector("#yood-list-quality").value;
                const directory = card.querySelector("#yood-list-folder").value.trim();
                for (const entryUrl of selected)
                    await invoke("enqueue_download", { request: { url: entryUrl, mode, quality, container: "mp4", context: kind, directory: directory || undefined } });
                closeOverlay();
                toast(`Added ${selected.length} video${selected.length === 1 ? "" : "s"} to the queue`);
            }
            catch (error) {
                toast(`Could not queue playlist: ${String(error)}`);
                start.disabled = false;
            }
        });
        actions.append(cancel, start);
        card.appendChild(actions);
    }
    catch (error) {
        card.innerHTML = `<h2>Unable to read ${kind}</h2><p>${escapeHtml(String(error))}</p>`;
    }
}
const WATCH_LATER_KEY = "yood-watch-later";
const WATCH_LATER_MAX_ITEMS = 200;
const WATCH_LATER_MAX_JSON_BYTES = 1024 * 1024;
function safeYoutubeImageUrl(value) {
    if (typeof value !== "string")
        return "";
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (url.protocol !== "https:")
            return "";
        if (host === "i.ytimg.com" || host === "img.youtube.com" || host === "yt3.ggpht.com")
            return url.href;
    }
    catch { /* invalid URL */ }
    return "";
}
function watchLaterThumb(id) {
    if (!id || /[^A-Za-z0-9_-]/.test(id) || id.length > 32)
        return "";
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}
function videoIdFromUrl(raw) {
    try {
        const parsed = new URL(raw, location.href);
        return parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || raw;
    }
    catch {
        return raw;
    }
}
function readWatchLater() {
    try {
        const raw = localStorage.getItem(WATCH_LATER_KEY) || "[]";
        if (raw.length > WATCH_LATER_MAX_JSON_BYTES) {
            localStorage.removeItem(WATCH_LATER_KEY);
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((item) => {
            if (!item || typeof item !== "object")
                return false;
            const candidate = item;
            return typeof candidate.id === "string" && candidate.id.length <= 128 &&
                typeof candidate.url === "string" && candidate.url.length <= 2048 &&
                isWatchLaterVideoUrl(candidate.url) &&
                typeof candidate.title === "string" && candidate.title.length <= 1000 &&
                typeof candidate.channel === "string" && candidate.channel.length <= 500 &&
                (candidate.thumb === undefined || typeof candidate.thumb === "string") &&
                (candidate.addedAt === undefined || Number.isFinite(candidate.addedAt));
        }).slice(0, WATCH_LATER_MAX_ITEMS);
    }
    catch {
        return [];
    }
}
function writeWatchLater(items) {
    try {
        localStorage.setItem(WATCH_LATER_KEY, JSON.stringify(items.slice(0, WATCH_LATER_MAX_ITEMS)));
    }
    catch { /* private mode */ }
}
function watchLaterById(id) {
    return readWatchLater().find((item) => item.id === id);
}
function currentWatchLaterEntry(url) {
    const id = videoIdFromUrl(url);
    const existing = watchLaterById(id);
    if (existing)
        return existing;
    return {
        id,
        url,
        title: document.title.replace(/ - YouTube$/, "").trim() || "Untitled",
        channel: document.querySelector("ytd-watch-metadata #owner ytd-channel-name a#text, #channel-name a, ytd-channel-name a, .ytd-channel-name a")?.textContent?.trim() ?? "",
        thumb: safeYoutubeImageUrl(watchLaterThumb(id)),
        addedAt: Date.now(),
    };
}
function toggleWatchLater(url) {
    const items = readWatchLater();
    const id = videoIdFromUrl(url);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
        items.unshift(currentWatchLaterEntry(url));
        writeWatchLater(items);
        updateWatchLaterUI();
        return true;
    }
    items.splice(index, 1);
    writeWatchLater(items);
    updateWatchLaterUI();
    return false;
}
function removeWatchLater(id) {
    writeWatchLater(readWatchLater().filter((item) => item.id !== id));
    updateWatchLaterUI();
}
function clearWatchLater() {
    writeWatchLater([]);
    updateWatchLaterUI();
}
// Drops and plain link pastes carry no title ("Untitled"). Resolve those
// lazily through YouTube's oEmbed endpoint (no key needed) the first time
// the panel opens, then persist the result with the entry.
const watchLaterTitleTried = new Set();
function resolveWatchLaterTitles(panel) {
    if (!panel || panel.hidden)
        return;
    const pending = readWatchLater()
        .filter((item) => (!item.title || item.title === "Untitled") && !watchLaterTitleTried.has(item.id))
        .slice(0, 5);
    pending.forEach((item) => {
        watchLaterTitleTried.add(item.id);
        fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(item.url)}&format=json`)
            .then((response) => {
            if (!response.ok)
                throw new Error("oembed unavailable");
            return response.json();
        })
            .then((data) => {
            if (typeof data.title !== "string" || !data.title)
                return;
            const items = readWatchLater();
            const found = items.find((entry) => entry.id === item.id);
            if (!found)
                return;
            found.title = data.title;
            if (typeof data.author_name === "string" && data.author_name)
                found.channel = data.author_name;
            writeWatchLater(items);
            const open = document.getElementById("yood-watch-later-panel");
            if (open && !open.hidden)
                renderWatchLaterPanelRows(open);
        })
            .catch(() => undefined);
    });
}
function refreshWatchLaterChip(chip, url) {
    const saved = Boolean(watchLaterById(videoIdFromUrl(url)));
    try {
        chip.textContent = saved ? yoodT("saved") : yoodT("watchLater");
    }
    catch {
        chip.textContent = saved ? "✓ Saved" : "Watch later";
    }
    chip.classList.toggle("yood-watch-later-saved", saved);
    chip.setAttribute("aria-pressed", String(saved));
}
function makeWatchLaterChip(url) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "yood-watch-later-button";
    chip.dataset.yoodWatchLater = url;
    try {
        chip.setAttribute("aria-label", yoodT("watchLater"));
    }
    catch {
        chip.setAttribute("aria-label", "Save to Yood Watch later");
    }
    chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const added = toggleWatchLater(url);
        refreshWatchLaterChip(chip, url);
        try {
            toast(added ? yoodT("savedTo") : yoodT("removedFrom"));
        }
        catch {
            toast(added ? "Saved to Watch later" : "Removed from Watch later");
        }
    });
    refreshWatchLaterChip(chip, url);
    return chip;
}
async function downloadAllWatchLater() {
    const items = readWatchLater();
    if (!items.length)
        return;
    try {
        toast(`${yoodT("sent")} (${items.length})`);
    }
    catch {
        toast(`Added ${items.length} videos to the queue`);
    }
    for (const item of items) {
        try {
            await invoke("enqueue_download", { request: { url: item.url, mode: "video", quality: "best", container: "mp4", context: "watch-later" } });
        }
        catch (error) {
            toast(`Could not queue download: ${String(error)}`);
            break;
        }
    }
}
function updateWatchLaterUI() {
    const items = readWatchLater();
    try {
        const laterBtn = document.getElementById("yood-later");
        if (laterBtn && laterBtn.firstChild)
            laterBtn.childNodes[0].textContent = yoodT("watchLater");
        const headLabel = document.querySelector("#yood-watch-later-panel .yood-watch-later-title span:first-child");
        if (headLabel)
            headLabel.textContent = yoodT("watchLater");
        const clearBtn = document.querySelector("#yood-watch-later-panel .yood-watch-later-clear");
        if (clearBtn)
            clearBtn.textContent = yoodT("clear");
        const allBtn = document.querySelector("#yood-watch-later-panel .yood-watch-later-all");
        if (allBtn)
            allBtn.textContent = yoodT("downloadAll");
    }
    catch { /* labels stay */ }
    const badge = document.querySelector("#yood-later .yood-dock-badge");
    if (badge) {
        badge.hidden = items.length === 0;
        badge.textContent = items.length > 99 ? "99+" : String(items.length);
    }
    document.querySelectorAll("[data-yood-watch-later]").forEach((chip) => {
        const url = chip.dataset.yoodWatchLater;
        if (url)
            refreshWatchLaterChip(chip, url);
    });
    const panel = document.getElementById("yood-watch-later-panel");
    if (panel && !panel.hidden)
        renderWatchLaterPanelRows(panel);
}
function renderWatchLaterPanelRows(panel) {
    const list = panel.querySelector("#yood-watch-later-items");
    if (!list)
        return;
    list.textContent = "";
    const items = readWatchLater();
    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "yood-watch-later-empty";
        try {
            empty.textContent = yoodT("empty");
        }
        catch {
            empty.textContent = "No videos saved yet";
        }
        list.appendChild(empty);
        return;
    }
    resolveWatchLaterTitles(panel);
    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "yood-watch-later-item";
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        const thumbUrl = safeYoutubeImageUrl(item.thumb) || watchLaterThumb(item.id);
        if (thumbUrl) {
            const thumb = document.createElement("img");
            thumb.src = thumbUrl;
            thumb.alt = "";
            thumb.loading = "lazy";
            thumb.className = "yood-wl-thumb";
            thumb.addEventListener("error", () => thumb.remove());
            row.appendChild(thumb);
        }
        const text = document.createElement("div");
        text.className = "yood-wl-text";
        const title = document.createElement("span");
        title.className = "yood-wl-title";
        title.title = item.title || "Untitled";
        title.textContent = item.title || "Untitled";
        text.append(title);
        if (item.channel) {
            const channel = document.createElement("span");
            channel.className = "yood-muted";
            channel.textContent = item.channel;
            text.appendChild(channel);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "yood-watch-later-remove";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", `Remove ${item.title || "video"} from Watch later`);
        remove.addEventListener("click", (event) => {
            event.stopPropagation();
            removeWatchLater(item.id);
            renderWatchLaterPanelRows(panel);
        });
        row.append(text, remove);
        const navigate = () => {
            panel.hidden = true;
            // Opening a saved video consumes it: it leaves Watch later.
            try {
                removeWatchLater(item.id);
            }
            catch { /* already gone */ }
            if (item.url !== currentUrl())
                window.location.href = item.url;
        };
        row.addEventListener("click", navigate);
        row.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate();
            }
        });
        list.appendChild(row);
    });
}
function ensureWatchLaterPanel() {
    if (!document.body || document.getElementById("yood-watch-later-panel"))
        return;
    const panel = document.createElement("div");
    panel.id = "yood-watch-later-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    try {
        panel.setAttribute("aria-label", yoodT("watchLater"));
    }
    catch {
        panel.setAttribute("aria-label", "Watch later");
    }
    const head = document.createElement("div");
    head.className = "yood-watch-later-title";
    const headLabel = document.createElement("span");
    try {
        headLabel.textContent = yoodT("watchLater");
    }
    catch {
        headLabel.textContent = "Watch later";
    }
    head.appendChild(headLabel);
    const all = document.createElement("button");
    all.type = "button";
    all.className = "yood-watch-later-clear yood-watch-later-all";
    try {
        all.textContent = yoodT("downloadAll");
    }
    catch {
        all.textContent = "Download all";
    }
    all.addEventListener("click", (event) => {
        event.stopPropagation();
        void downloadAllWatchLater();
    });
    head.appendChild(all);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "yood-watch-later-clear";
    try {
        clear.textContent = yoodT("clear");
    }
    catch {
        clear.textContent = "Clear";
    }
    clear.addEventListener("click", (event) => {
        event.stopPropagation();
        clearWatchLater();
        renderWatchLaterPanelRows(panel);
    });
    head.appendChild(clear);
    const list = document.createElement("div");
    list.id = "yood-watch-later-items";
    panel.append(head, list);
    document.body.appendChild(panel);
    renderWatchLaterPanelRows(panel);
    document.addEventListener("click", (event) => {
        const node = document.getElementById("yood-watch-later-panel");
        const later = document.getElementById("yood-later");
        if (!node || node.hidden)
            return;
        if (node.contains(event.target) || later?.contains(event.target))
            return;
        node.hidden = true;
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape")
            return;
        const node = document.getElementById("yood-watch-later-panel");
        if (node && !node.hidden)
            node.hidden = true;
    }, true);
}
function toggleWatchLaterPanel() {
    const panel = document.getElementById("yood-watch-later-panel");
    if (!panel)
        return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden)
        renderWatchLaterPanelRows(panel);
}
// ---- Drag & drop into Watch later: grab any video card and drop it on the
// dock's Watch later button, a Watch later chip, or the open panel — no
// need to open the video first. Anchors are natively draggable, so nothing
// is marked `draggable` (that would disturb YouTube's own handlers); drops
// carrying no YouTube video URL are left alone.
const WATCH_LATER_MIME = "application/x-yood-video";
const WATCH_LATER_DROP_SELECTOR = "#yood-dock, #yood-later, [data-yood-watch-later], #yood-watch-later-panel";
function isWatchLaterVideoUrl(raw) {
    if (!raw)
        return false;
    try {
        const parsed = new URL(raw, location.href);
        if (parsed.protocol !== "https:")
            return false;
        const host = parsed.hostname.toLowerCase();
        if (host === "youtu.be")
            return true;
        if (host === "youtube.com" || host.endsWith(".youtube.com")) {
            return /\/watch/i.test(parsed.pathname) || /^\/shorts\//i.test(parsed.pathname) || /^\/live\//i.test(parsed.pathname);
        }
        return false;
    }
    catch {
        return false;
    }
}
function cardWatchLaterEntry(card) {
    const url = videoUrlFrom(card);
    if (!url)
        return null;
    const id = videoIdFromUrl(url);
    const titleNode = card.querySelector("#video-title, a#video-title, yt-formatted-string");
    const title = titleNode?.textContent?.trim()
        || document.title.replace(/ - YouTube$/, "").trim()
        || "Untitled";
    const channel = card.querySelector("#channel-name a, ytd-channel-name a, .ytd-channel-name a")?.textContent?.trim() ?? "";
    const img = card.querySelector("img[src*='ytimg.com']");
    const src = img?.currentSrc || img?.src || "";
    const thumb = safeYoutubeImageUrl(src.split(" ")[0]) || watchLaterThumb(id);
    return { id, url, title, channel, thumb, addedAt: Date.now() };
}
// Add-only: dropping an already-saved video reports it instead of
// removing it (unlike the chip's toggle on click).
function watchLaterAdd(entry) {
    if (!isWatchLaterVideoUrl(entry.url) || watchLaterById(videoIdFromUrl(entry.url)))
        return false;
    const id = videoIdFromUrl(entry.url);
    const items = readWatchLater();
    items.unshift({
        id,
        url: entry.url,
        title: entry.title || "Untitled",
        channel: entry.channel || "",
        thumb: safeYoutubeImageUrl(entry.thumb) || watchLaterThumb(id),
        addedAt: Date.now(),
    });
    writeWatchLater(items);
    updateWatchLaterUI();
    return true;
}
function watchLaterEntryFromDrop(event) {
    const dt = event.dataTransfer;
    if (!dt)
        return null;
    try {
        const tagged = dt.getData(WATCH_LATER_MIME);
        if (tagged) {
            const parsed = JSON.parse(tagged);
            if (typeof parsed.url === "string" && isWatchLaterVideoUrl(parsed.url)) {
                const thumb = safeYoutubeImageUrl(parsed.thumb);
                return {
                    url: parsed.url,
                    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Untitled",
                    channel: typeof parsed.channel === "string" ? parsed.channel.trim() : "",
                    thumb,
                };
            }
        }
    }
    catch { /* fall through to plain URL payloads */ }
    const payloads = [];
    try {
        payloads.push(dt.getData("text/uri-list") || "");
    }
    catch { /* next */ }
    try {
        payloads.push(dt.getData("text/plain") || "");
    }
    catch { /* next */ }
    try {
        payloads.push(dt.getData("text/html") || "");
    }
    catch { /* next */ }
    for (const payload of payloads) {
        for (const line of payload.split(/\r?\n/)) {
            const token = line.trim();
            if (!token || token.startsWith("#"))
                continue;
            const candidate = token.split(/\s+/)[0];
            if (isWatchLaterVideoUrl(candidate))
                return { url: candidate, title: "Untitled", channel: "", thumb: "" };
        }
    }
    // Last resort: fish a video URL out of HTML payloads (bare image drags
    // carry <img> markup instead of a link).
    const html = payloads.join("\n").replace(/&amp;/g, "&");
    const found = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^"'<>\s]*|shorts\/[\w-]+|live\/[\w-]+)|youtu\.be\/[\w-]+)/i.exec(html);
    if (found && isWatchLaterVideoUrl(found[0]))
        return { url: found[0], title: "Untitled", channel: "", thumb: "" };
    return null;
}
function installMiddleClickWatchLater() {
    if (window.__yoodMiddle)
        return;
    window.__yoodMiddle = true;
    const pickEntry = (target) => {
        try {
            const card = target.closest(SCANNABLE_CARD_SELECTOR);
            if (card) {
                const found = cardWatchLaterEntry(card);
                if (found && isWatchLaterVideoUrl(found.url))
                    return { url: found.url, title: found.title, channel: found.channel, thumb: found.thumb };
            }
            const link = target.closest('a[href*="/watch"], a[href*="/shorts/"], a[href*="/live/"], a[href*="youtu.be/"]');
            if (link?.href && isWatchLaterVideoUrl(link.href)) {
                try {
                    return { url: new URL(link.href, location.href).href, title: "Untitled", channel: "", thumb: "" };
                }
                catch {
                    return null;
                }
            }
            if (/youtube\.com\/(watch|shorts\/|live\/)/i.test(location.href)) {
                if (target.closest("ytd-watch-metadata, #movie_player, ytd-reel-video-renderer, ytd-shorts")) {
                    return { url: location.href, title: "", channel: "", thumb: "" };
                }
            }
        }
        catch { /* no entry */ }
        return null;
    };
    const onMiddle = (event) => {
        if (event.button !== 1)
            return;
        let t = null;
        try {
            const path = event.composedPath?.() ?? [];
            for (const n of path)
                if (n instanceof Element) {
                    t = n;
                    break;
                }
            if (!t)
                t = event.target instanceof Element ? event.target : null;
        }
        catch {
            return;
        }
        if (!t)
            return;
        const found = pickEntry(t);
        if (!found?.url)
            return;
        event.preventDefault();
        event.stopPropagation();
        try {
            event.stopImmediatePropagation();
        }
        catch { /* once */ }
        if (watchLaterById(videoIdFromUrl(found.url))) {
            try {
                toast(yoodT("alreadyIn"));
            }
            catch {
                toast("Already in Watch later");
            }
            return;
        }
        let title = (found.title || "").trim();
        if (!title || title === "Untitled") {
            try {
                const card = t.closest(SCANNABLE_CARD_SELECTOR);
                title = card?.querySelector("#video-title, a#video-title, yt-formatted-string")?.textContent?.trim() || "Untitled";
            }
            catch {
                title = "Untitled";
            }
        }
        watchLaterAdd({ url: found.url, title: title || "Untitled", channel: found.channel || "", thumb: found.thumb || undefined });
        try {
            toast(yoodT("savedTo"));
        }
        catch {
            toast("Saved to Watch later");
        }
    };
    document.addEventListener("mousedown", onMiddle, true);
    document.addEventListener("auxclick", onMiddle, true);
    document.addEventListener("click", ((event) => {
        try {
            if (event.button === 1) {
                event.preventDefault();
                event.stopPropagation();
            }
        }
        catch { /* noop */ }
    }), true);
}
function installWatchLaterDragDrop() {
    if (window.__yoodWatchLaterDnD)
        return;
    window.__yoodWatchLaterDnD = true;
    document.addEventListener("dragstart", (event) => {
        const target = event.target;
        const dt = event.dataTransfer;
        if (!target?.closest || !dt)
            return;
        let entry = null;
        const card = target.closest(SCANNABLE_CARD_SELECTOR);
        if (card) {
            entry = cardWatchLaterEntry(card);
        }
        else {
            // Reel, player area, bare thumbnails: a dragged <img> carries only
            // its image URL, so enrich from the video on screen instead.
            const reel = target.closest("ytd-reel-video-renderer, ytd-shorts");
            if (reel && /youtube\.com\/shorts\//i.test(location.href)) {
                entry = currentWatchLaterEntry(location.href);
                const reelImg = reel.querySelector("img[src*='ytimg.com']");
                const reelSrc = reelImg?.currentSrc || reelImg?.src || "";
                const safeReelThumb = safeYoutubeImageUrl(reelSrc.split(" ")[0]);
                if (safeReelThumb)
                    entry.thumb = safeReelThumb;
            }
            else {
                const meta = target.closest("ytd-watch-metadata, #movie_player");
                if (meta && /youtube\.com\/(watch|live\/)/i.test(location.href)) {
                    entry = currentWatchLaterEntry(location.href);
                }
            }
        }
        if (!entry)
            return;
        try {
            dt.setData(WATCH_LATER_MIME, JSON.stringify({ url: entry.url, title: entry.title, channel: entry.channel, thumb: entry.thumb }));
        }
        catch { /* native drag still carries the link URL */ }
        try {
            dt.setData("text/plain", entry.url);
        }
        catch { /* next */ }
        try {
            dt.setData("text/uri-list", entry.url);
        }
        catch { /* next */ }
        try {
            dt.effectAllowed = "copy";
        }
        catch { /* hint only */ }
    }, true);
    let hot = null;
    const clearHot = () => { hot?.classList.remove("yood-drop-hot"); hot = null; };
    document.addEventListener("dragover", (event) => {
        const zone = event.target?.closest?.(WATCH_LATER_DROP_SELECTOR);
        const dt = event.dataTransfer;
        if (!zone || !dt) {
            if (!zone)
                clearHot();
            return;
        }
        // Always allow the drop on Yood zones and validate on drop: Chrome hides
        // custom drag types during dragover, so type-checking here breaks link drags.
        event.preventDefault();
        try {
            dt.dropEffect = "copy";
        }
        catch { /* hint only */ }
        if (hot !== zone) {
            clearHot();
            hot = zone;
            zone.classList.add("yood-drop-hot");
        }
    }, true);
    document.addEventListener("drop", (event) => {
        const zone = event.target?.closest?.(WATCH_LATER_DROP_SELECTOR);
        if (!zone)
            return;
        event.preventDefault();
        event.stopPropagation();
        clearHot();
        const entry = watchLaterEntryFromDrop(event);
        if (!entry)
            return;
        if (watchLaterById(videoIdFromUrl(entry.url))) {
            try {
                toast(yoodT("alreadyIn"));
            }
            catch {
                toast("Already in Watch later");
            }
            return;
        }
        const title = entry.title !== "Untitled"
            ? entry.title
            : document.title.replace(/ - YouTube$/, "").trim() || "Untitled";
        watchLaterAdd({ ...entry, title });
        try {
            toast(yoodT("savedTo"));
        }
        catch {
            toast("Saved to Watch later");
        }
    }, true);
    document.addEventListener("dragend", clearHot, true);
}
function ensureLauncher() {
    if (!document.body || document.getElementById("yood-dock"))
        return;
    const dock = document.createElement("div");
    dock.id = "yood-dock";
    const launcher = document.createElement("button");
    launcher.id = "yood-launcher";
    launcher.type = "button";
    launcher.textContent = "↓ Yood";
    launcher.title = "Open Yood downloads and settings";
    const badge = document.createElement("span");
    badge.className = "yood-dock-badge";
    badge.hidden = true;
    launcher.appendChild(badge);
    launcher.addEventListener("click", () => showManager());
    const later = document.createElement("button");
    later.id = "yood-later";
    later.type = "button";
    try {
        later.textContent = yoodT("watchLater");
    }
    catch {
        later.textContent = "Watch later";
    }
    later.title = "Yood Watch later — drag videos here or click to open";
    try {
        later.setAttribute("aria-label", yoodT("watchLater"));
    }
    catch {
        later.setAttribute("aria-label", "Watch later list");
    }
    const laterBadge = document.createElement("span");
    laterBadge.className = "yood-dock-badge";
    laterBadge.hidden = true;
    later.appendChild(laterBadge);
    dock.append(launcher, later);
    document.body.appendChild(dock);
    updateWatchLaterUI();
}
function installYoodControlClickCapture() {
    document.addEventListener("click", (event) => {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
        let control = null;
        for (const node of path) {
            if (!(node instanceof HTMLElement))
                continue;
            if (node.matches("[data-yood-download], [data-yood-watch-later], #yood-later, #yood-url-button")) {
                control = node;
                break;
            }
        }
        if (!control)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (control.matches("[data-yood-download]")) {
            const url = control.dataset.yoodDownload;
            if (!url)
                return;
            const context = control.dataset.yoodContext || "video";
            if (context === "playlist" || context === "channel") {
                void showPlaylistDialog(url, context);
            }
            else {
                showDownloadDialog(url, context);
            }
        }
        else if (control.matches("[data-yood-watch-later]")) {
            const url = control.dataset.yoodWatchLater;
            if (!url)
                return;
            const added = toggleWatchLater(url);
            refreshWatchLaterChip(control, url);
            try {
                toast(added ? yoodT("savedTo") : yoodT("removedFrom"));
            }
            catch {
                toast(added ? "Saved to Watch later" : "Removed from Watch later");
            }
        }
        else if (control.id === "yood-later") {
            toggleWatchLaterPanel();
        }
        else if (control.id === "yood-url-button") {
            showUrlBar();
        }
    }, true);
}
const activeDownloadItems = new Map();
function ensureDownloadBar() {
    if (!document.body || document.getElementById("yood-download-bar"))
        return;
    const bar = document.createElement("button");
    bar.id = "yood-download-bar";
    bar.type = "button";
    bar.hidden = true;
    bar.setAttribute("aria-label", "Open Yood downloads");
    const label = document.createElement("span");
    label.className = "yood-bar-label";
    const progress = document.createElement("span");
    progress.className = "yood-bar-progress";
    progress.innerHTML = "<i style='width:0%'></i>";
    bar.append(label, progress);
    bar.addEventListener("click", () => showManager());
    document.body.appendChild(bar);
    void invoke("list_downloads").then((items) => {
        activeDownloadItems.clear();
        items.forEach((item) => applyActiveDownloadState(item));
        renderDownloadSummary();
    }).catch(() => undefined);
}
function applyActiveDownloadState(item) {
    const active = ["downloading", "paused", "queued", "interrupted"].includes(item.status);
    if (active)
        activeDownloadItems.set(item.id, { status: item.status, progress: item.progress });
    else
        activeDownloadItems.delete(item.id);
    renderDownloadSummary();
}
function renderDownloadSummary() {
    const badge = document.querySelector("#yood-launcher .yood-dock-badge");
    const count = activeDownloadItems.size;
    if (badge) {
        badge.hidden = count === 0;
        badge.textContent = count > 99 ? "99+" : String(count);
    }
    const bar = document.getElementById("yood-download-bar");
    if (!bar || !document.body.contains(bar))
        return;
    const downloading = [...activeDownloadItems.values()].filter((item) => item.status === "downloading");
    const label = bar.querySelector(".yood-bar-label");
    const fill = bar.querySelector(".yood-bar-progress > i");
    if (count === 0 || !label || !fill) {
        bar.hidden = count === 0 || !bar.dataset.yoodForced;
        return;
    }
    bar.hidden = false;
    if (count === 1 && downloading.length === 1) {
        label.textContent = `↓ ${Math.round(downloading[0].progress)}%`;
        fill.style.width = `${Math.max(0, Math.min(100, downloading[0].progress))}%`;
    }
    else {
        const avg = downloading.length
            ? downloading.reduce((sum, item) => sum + item.progress, 0) / downloading.length
            : 0;
        label.textContent = `↓ ${count} ${count === 1 ? "download" : "downloads"}`;
        fill.style.width = `${downloading.length ? Math.max(0, Math.min(100, avg)) : 0}%`;
    }
}
let downloadPollingTimer;
function listenForDownloadUpdates() {
    void listenEvent("download-updated", (event) => {
        const item = event.payload;
        if (item?.id && document.getElementById("yood-download-bar"))
            applyActiveDownloadState(item);
    });
    const refresh = async () => {
        if (!document.hidden) {
            try {
                const items = await invoke("list_downloads");
                if (Array.isArray(items)) {
                    activeDownloadItems.clear();
                    items.forEach((item) => applyActiveDownloadState(item));
                }
            }
            catch { /* retry on the next bounded tick */ }
        }
        if (downloadPollingTimer !== undefined)
            window.clearTimeout(downloadPollingTimer);
        const managerOpen = Boolean(document.querySelector(".yood-overlay"));
        downloadPollingTimer = window.setTimeout(refresh, activeDownloadItems.size || managerOpen ? 1000 : 5000);
    };
    void refresh();
}
function managerState(status) {
    if (status === "downloading" || status === "paused")
        return "active";
    if (status === "queued" || status === "interrupted")
        return "queued";
    if (status === "completed")
        return "completed";
    return "failed";
}
function renderManagerRow(item) {
    const row = document.createElement("div");
    row.className = "yood-entry";
    row.dataset.yoodDownloadId = item.id;
    const safeTitle = escapeHtml(item.title || item.id);
    row.innerHTML = `<div style="flex:1"><strong>${safeTitle}</strong><div class="yood-muted">${escapeHtml(item.channel || "")} · ${escapeHtml(item.status)}${item.speed ? ` · ${escapeHtml(item.speed)}` : ""}${item.eta ? ` · ETA ${escapeHtml(item.eta)}` : ""}</div><div class="yood-progress"><i style="width:${Math.max(0, Math.min(100, item.progress || 0))}%"></i></div></div>`;
    if (["downloading", "paused", "queued", "interrupted"].includes(item.status)) {
        const action = button(item.status === "paused" ? "Resume" : "Pause");
        action.addEventListener("click", async () => { action.disabled = true; try {
            await invoke(item.status === "paused" ? "resume_download" : "pause_download", { id: item.id });
        }
        finally {
            action.disabled = false;
        } });
        row.appendChild(action);
        const cancel = button("Cancel");
        cancel.addEventListener("click", async () => { cancel.disabled = true; try {
            await invoke("cancel_download", { id: item.id });
        }
        finally {
            cancel.disabled = false;
        } });
        row.appendChild(cancel);
    }
    if (item.status === "failed") {
        const retry = button("Retry");
        retry.addEventListener("click", async () => { retry.disabled = true; try {
            await invoke("retry_download", { id: item.id });
        }
        finally {
            retry.disabled = false;
        } });
        row.appendChild(retry);
    }
    if (item.status === "completed") {
        const open = button("Open");
        open.addEventListener("click", () => invoke("open_download", { id: item.id }));
        row.appendChild(open);
        const folder = button("Show folder");
        folder.addEventListener("click", () => invoke("open_download_folder", { id: item.id }));
        row.appendChild(folder);
        const player = button("Player");
        player.addEventListener("click", () => invoke("open_native_player", { id: item.id }));
        row.appendChild(player);
    }
    if (["completed", "failed", "cancelled"].includes(item.status)) {
        const remove = button("Remove");
        remove.addEventListener("click", async () => {
            remove.disabled = true;
            try {
                await invoke("remove_download", { id: item.id });
                row.remove();
            }
            catch (error) {
                toast(`Could not remove download: ${String(error)}`);
                remove.disabled = false;
            }
        });
        row.appendChild(remove);
    }
    return row;
}
async function showManager() {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "yood-overlay";
    const card = document.createElement("section");
    card.className = "yood-card";
    card.innerHTML = "<h2>Yood Downloads</h2><p class='yood-muted'>Loading…</p>";
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try {
        const items = await invoke("list_downloads");
        card.innerHTML = "<h2>Yood Downloads</h2>";
        const sections = {};
        for (const state of ["active", "queued", "completed", "failed"]) {
            const heading = document.createElement("h3");
            heading.textContent = state[0].toUpperCase() + state.slice(1);
            card.appendChild(heading);
            sections[state] = document.createElement("div");
            card.appendChild(sections[state]);
        }
        items.forEach((item) => sections[managerState(item.status)].appendChild(renderManagerRow(item)));
        const actions = document.createElement("div");
        actions.className = "yood-actions";
        const settings = button("Settings");
        settings.addEventListener("click", () => showSettings());
        const close = button("Close", true);
        close.addEventListener("click", closeOverlay);
        actions.append(settings, close);
        card.appendChild(actions);
        // Live-update rows in place as the backend reports progress, rather than
        // re-fetching and rebuilding the whole dialog on a timer or leaving the
        // dialog static until it is reopened.
        let refreshQueued = false;
        const applyUpdate = (item) => {
            const existing = sections[managerState(item.status)].querySelector(`[data-yood-download-id="${item.id}"]`);
            const target = sections[managerState(item.status)];
            const replacement = renderManagerRow(item);
            if (existing && existing.parentElement === target) {
                existing.replaceWith(replacement);
                return;
            }
            // The item moved between sections (e.g. queued -> active) or is new.
            document.querySelector(`[data-yood-download-id="${item.id}"]`)?.remove();
            target.appendChild(replacement);
        };
        const scheduleFullRefresh = () => {
            if (refreshQueued)
                return;
            refreshQueued = true;
            void invoke("list_downloads").then((freshItems) => {
                refreshQueued = false;
                if (!document.body.contains(card))
                    return;
                const seen = new Set();
                freshItems.forEach((item) => { seen.add(item.id); applyUpdate(item); });
                card.querySelectorAll("[data-yood-download-id]").forEach((row) => {
                    if (!seen.has(row.dataset.yoodDownloadId || ""))
                        row.remove();
                });
            }).catch(() => { refreshQueued = false; });
        };
        const unlistenPromise = listenEvent("download-updated", (event) => {
            const item = event.payload;
            if (!item?.id || !document.body.contains(card))
                return;
            // A single item's progress/status update is applied directly. New
            // items and removals require the full list to know their place.
            if (card.querySelector(`[data-yood-download-id="${item.id}"]`)) {
                applyUpdate(item);
            }
            else {
                scheduleFullRefresh();
            }
        });
        closeManagerLive = () => { void unlistenPromise.then((unlisten) => unlisten()); };
    }
    catch (error) {
        card.innerHTML = `<h2>Downloads unavailable</h2><p>${escapeHtml(String(error))}</p>`;
    }
}
function formatTimestamp(value) {
    if (!value)
        return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}
async function showSettings() {
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "yood-overlay";
    const card = document.createElement("section");
    card.className = "yood-card";
    card.innerHTML = "<h2>Yood Settings</h2><p class='yood-muted'>Loading…</p>";
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try {
        const [settings, appInfo, accountHints] = await Promise.all([
            invoke("get_settings_for_ui"),
            invoke("get_app_info").catch(() => null),
            invoke("get_account_hints").catch(() => null),
        ]);
        card.innerHTML = "<h2>Yood Settings</h2>";
        card.innerHTML += `
      <h3>Appearance</h3>
      <div class="yood-row"><label for="yood-theme">Theme</label><select id="yood-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
      <h3>Accounts</h3>
      <div class="yood-row"><label for="yood-account-label">Account label<br><span class="yood-muted">A private note to tell accounts apart. Yood never stores your Google password.</span></label><input id="yood-account-label" type="text" placeholder="e.g. Family account"></div>
      <h3>Privacy &amp; Ad Blocking</h3>
      <div class="yood-row"><label>Ad blocking<br><span class="yood-muted">Always on and cannot be disabled.</span></label><span class="yood-muted">${appInfo ? escapeHtml(String(appInfo.filter.rule_count)) + " rules" : "—"}</span></div>
      <div class="yood-row"><label>Filter lists last updated</label><span class="yood-muted">${appInfo ? escapeHtml(formatTimestamp(appInfo.filter.last_success)) : "—"}</span></div>
      <div class="yood-row"><label for="yood-tracking">Tracking protection</label><input id="yood-tracking" type="checkbox"></div>
      <div class="yood-row"><label for="yood-aggressive-tracking">Aggressive tracking protection<br><span class="yood-muted">May affect some YouTube account features.</span></label><input id="yood-aggressive-tracking" type="checkbox"></div>
      <div class="yood-row"><button id="yood-update-filters" type="button" class="yood-secondary">Update filter lists now</button></div>
      <h3>General</h3>
      <div class="yood-row"><label for="yood-log-level">Log level<br><span class="yood-muted">Written to a local file only. Logs never contain passwords, cookies, or tokens.</span></label><select id="yood-log-level"><option>ERROR</option><option>WARN</option><option>INFO</option><option>DEBUG</option><option>TRACE</option></select></div>
      <div class="yood-row"><label for="yood-shortcut">Download shortcut<br><span class="yood-muted">Shift + this key opens the download dialog.</span></label><input id="yood-shortcut" type="text" maxlength="1" placeholder="d"></div>
      <h3>Downloads</h3>
      <div class="yood-row"><label for="yood-concurrency">Concurrent downloads</label><input id="yood-concurrency" type="number" min="1" max="4"></div>
      <div class="yood-row"><label for="yood-folder">Download folder</label><input id="yood-folder" type="text"><button id="yood-folder-browse" type="button" class="yood-secondary">Browse…</button></div>
      <div class="yood-row"><label for="yood-temp">Temporary folder</label><input id="yood-temp" type="text"></div>
      <div class="yood-row"><label for="yood-clean">Clean temporary files on exit</label><input id="yood-clean" type="checkbox"></div>
      <div class="yood-row"><label for="yood-overwrite">Replace existing files<br><span class="yood-muted">Off keeps both files with a number suffix.</span></label><input id="yood-overwrite" type="checkbox"></div>
      <h3>Advanced Downloads</h3>
      <div class="yood-row"><label for="yood-embed-thumb">Embed thumbnail and metadata by default</label><input id="yood-embed-thumb" type="checkbox"></div>
      <div class="yood-row"><label for="yood-subs">Download subtitles by default</label><input id="yood-subs" type="checkbox"></div>
      <div class="yood-row"><label for="yood-sub-lang">Subtitle language</label><input id="yood-sub-lang" type="text" maxlength="16" placeholder="en"></div>
      <h3>About</h3>
      <div class="yood-row"><label>Yood version</label><span class="yood-muted">${appInfo ? escapeHtml(appInfo.version) : "—"}</span></div>
      ${appInfo ? appInfo.binaries.map((binary) => `<div class="yood-row"><label>${escapeHtml(binary.name)}</label><span class="yood-muted">${binary.available ? escapeHtml(binary.version || "installed") + (binary.bundled ? " (bundled)" : " (system)") : "Not available"}</span></div>`).join("") : ""}
      <div class="yood-row"><button id="yood-update-ytdlp" type="button" class="yood-secondary">Update yt-dlp now</button></div>
    `;
        card.querySelector("#yood-theme").value = settings.appearance;
        card.querySelector("#yood-account-label").value = accountHints || "";
        card.querySelector("#yood-tracking").checked = settings.tracking_protection;
        card.querySelector("#yood-aggressive-tracking").checked = settings.aggressive_tracking_protection;
        const trackingSupported = appInfo?.filter.tracking_supported !== false;
        card.querySelector("#yood-tracking").disabled = !trackingSupported;
        card.querySelector("#yood-aggressive-tracking").disabled = !trackingSupported;
        card.querySelector("#yood-concurrency").value = String(settings.max_concurrent_downloads);
        card.querySelector("#yood-folder").value = settings.download_directory;
        card.querySelector("#yood-temp").value = settings.temp_directory;
        card.querySelector("#yood-clean").checked = settings.cleanup_temp_files;
        card.querySelector("#yood-overwrite").checked = settings.overwrite_existing;
        card.querySelector("#yood-embed-thumb").checked = settings.embed_thumbnail;
        card.querySelector("#yood-subs").checked = settings.download_subtitles;
        card.querySelector("#yood-sub-lang").value = settings.subtitle_language;
        card.querySelector("#yood-log-level").value = settings.log_level;
        card.querySelector("#yood-shortcut").value = settings.shortcut_download;
        const updateFilters = card.querySelector("#yood-update-filters");
        updateFilters?.addEventListener("click", async () => {
            updateFilters.disabled = true;
            const original = updateFilters.textContent;
            updateFilters.textContent = "Updating…";
            try {
                await invoke("update_filter_lists");
                toast("Filter lists updated");
                showSettings();
            }
            catch (error) {
                toast(`Could not update filter lists: ${String(error)}`);
                updateFilters.disabled = false;
                updateFilters.textContent = original;
            }
        });
        const updateYtdlp = card.querySelector("#yood-update-ytdlp");
        updateYtdlp?.addEventListener("click", async () => {
            updateYtdlp.disabled = true;
            const original = updateYtdlp.textContent;
            updateYtdlp.textContent = "Updating…";
            try {
                const version = await invoke("update_ytdlp");
                toast(`yt-dlp updated to ${String(version)}`);
                showSettings();
            }
            catch (error) {
                toast(`Could not update yt-dlp: ${String(error)}`);
                updateYtdlp.disabled = false;
                updateYtdlp.textContent = original;
            }
        });
        const browseFolder = card.querySelector("#yood-folder-browse");
        browseFolder?.addEventListener("click", async () => {
            browseFolder.disabled = true;
            try {
                const folder = await invoke("pick_folder");
                if (folder)
                    card.querySelector("#yood-folder").value = folder;
            }
            catch (error) {
                toast(`Could not pick folder: ${String(error)}`);
            }
            finally {
                browseFolder.disabled = false;
            }
        });
        const actions = document.createElement("div");
        actions.className = "yood-actions";
        const cancel = button("Cancel");
        cancel.addEventListener("click", closeOverlay);
        const save = button("Save", true);
        save.addEventListener("click", async () => {
            save.disabled = true;
            try {
                const appearance = card.querySelector("#yood-theme").value;
                const accountLabel = card.querySelector("#yood-account-label").value.trim();
                const settingsPatch = {
                    appearance,
                    tracking_protection: card.querySelector("#yood-tracking").checked,
                    aggressive_tracking_protection: card.querySelector("#yood-aggressive-tracking").checked,
                    max_concurrent_downloads: Number(card.querySelector("#yood-concurrency").value),
                    download_directory: card.querySelector("#yood-folder").value,
                    temp_directory: card.querySelector("#yood-temp").value,
                    cleanup_temp_files: card.querySelector("#yood-clean").checked,
                    overwrite_existing: card.querySelector("#yood-overwrite").checked,
                    embed_thumbnail: card.querySelector("#yood-embed-thumb").checked,
                    download_subtitles: card.querySelector("#yood-subs").checked,
                    subtitle_language: card.querySelector("#yood-sub-lang").value.trim() || "en",
                    log_level: card.querySelector("#yood-log-level").value,
                    shortcut_download: card.querySelector("#yood-shortcut").value.trim().toLowerCase() || "d",
                };
                // Start both user-initiated operations before the first await; the
                // browser's user-activation flag is intentionally time-limited.
                const accountUpdate = accountLabel
                    ? invoke("set_account_hints", { value: accountLabel })
                    : invoke("clear_account_hints").catch(() => undefined);
                await Promise.all([invoke("update_settings", { patch: settingsPatch }), accountUpdate]);
                await window.__yoodRefreshTracking?.();
                applyAppearance(appearance, true);
                downloadShortcut = card.querySelector("#yood-shortcut").value.trim().toLowerCase() || "d";
                closeOverlay();
                toast("Settings saved");
            }
            catch (error) {
                toast(`Could not save settings: ${String(error)}`);
                save.disabled = false;
            }
        });
        actions.append(cancel, save);
        card.appendChild(actions);
    }
    catch (error) {
        card.innerHTML = `<h2>Settings unavailable</h2><p>${escapeHtml(String(error))}</p>`;
    }
}
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
const AD_RENDERER_SELECTORS = [
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-banner-promo-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-video-renderer",
    "ytd-compact-promoted-video-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-companion-slot-renderer",
    "ytd-action-companion-ad-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer",
    "#player-ads",
    "#masthead-ad",
    "#panels ytd-engagement-panel-section-list-renderer[target-id=engagement-panel-ads]",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    ".ytp-ad-player-overlay",
    ".ytp-ad-text",
    ".video-ads",
    ".ytd-ad-slot-renderer",
];
const AD_RENDERER_SELECTOR = AD_RENDERER_SELECTORS.join(",");
const AD_CARD_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-reel-item-renderer",
].join(",");
const STATIC_AD_SELECTORS = [...AD_RENDERER_SELECTORS, "[data-yood-ad-removed]"]
    .join(",");
const FEED_CARD_SELECTOR = "ytd-rich-item-renderer";
const PLAYABLE_CARD_SELECTOR = 'a[href*="/watch?v="], a[href*="/shorts/"], a[href*="/live/"], ytd-rich-grid-media, ytd-reel-item-renderer';
function containsAdPayload(value) {
    const queue = [value];
    const seen = new Set();
    for (let inspected = 0; queue.length && inspected < 128; inspected += 1) {
        const current = queue.pop();
        if (!current || typeof current !== "object" || seen.has(current))
            continue;
        seen.add(current);
        for (const [key, nested] of Object.entries(current)) {
            if (/^(?:ad(?:slot|placements?|slots|break|layout|renderer|playbackcontext)|playerads|promoted(?:sparkles)?(?:renderer)?|companion(?:slot)?renderer)$/i.test(key))
                return true;
            if (nested && typeof nested === "object")
                queue.push(nested);
        }
    }
    return false;
}
function removeGhostFeedCards(root) {
    const cards = [];
    if (root instanceof Element && root.matches(FEED_CARD_SELECTOR))
        cards.push(root);
    cards.push(...root.querySelectorAll(FEED_CARD_SELECTOR));
    let removed = false;
    for (const card of cards) {
        if (!card.isConnected || card.querySelector(PLAYABLE_CARD_SELECTOR))
            continue;
        const data = card.data;
        if (card.querySelector(AD_RENDERER_SELECTOR) || containsAdPayload(data)) {
            card.setAttribute("data-yood-ad-removed", "");
            card.remove();
            removed = true;
        }
    }
    return removed;
}
function removeKnownAds(root = document) {
    const renderers = [];
    if (root instanceof Element && root.matches(AD_RENDERER_SELECTOR))
        renderers.push(root);
    renderers.push(...root.querySelectorAll(AD_RENDERER_SELECTOR));
    let removed = false;
    for (const renderer of renderers) {
        if (!renderer.isConnected)
            continue;
        // Removing the ad's own card (rather than just the inner ad element)
        // avoids leaving a visibly blank tile in the feed. YouTube's own grid
        // rows are a fixed-count layout decided by its JS at render time, not a
        // fluid CSS grid, so a removed card is *not* automatically backfilled by
        // the next video the way a real CSS grid would. Yood used to fix that by
        // physically moving later videos into the gap, but that corrupted
        // YouTube's internal row/virtualization bookkeeping and made rows render
        // with fewer items than fit on screen. Leaving a gap where an ad used to
        // be is standard, expected ad-blocker behaviour (this is what Brave and
        // uBlock Origin do too) and is far safer than reaching into YouTube's
        // component internals.
        const card = renderer.closest(AD_CARD_SELECTOR);
        if (card) {
            card.setAttribute("data-yood-ad-removed", "");
            card.remove();
        }
        else {
            renderer.remove();
        }
        removed = true;
    }
    if (removeGhostFeedCards(root))
        removed = true;
    return removed;
}
const PLAYER_AD_RESPONSE_KEYS = new Set([
    "adplacements",
    "adslots",
    "adcueranges",
    "playerads",
    "adparams",
    "adbreakheartbeatparams",
    "adplaybackcontext",
    "adbreakservicerenderer",
    "adslotrenderer",
    "adlayoutrenderer",
    "instreamvideoadrenderer",
    "playerlegacydesktopwatchadsrenderer",
    "promotedsparkleswebrenderer",
    "companionslotrenderer",
    "actioncompanionadrenderer",
]);
function stripPlayerAdPayload(payload) {
    const queue = [payload];
    const seen = new Set();
    let changed = false;
    for (let inspected = 0; queue.length && inspected < 20000; inspected += 1) {
        const current = queue.pop();
        if (!current || typeof current !== "object" || seen.has(current))
            continue;
        seen.add(current);
        for (const [key, nested] of Object.entries(current)) {
            if (PLAYER_AD_RESPONSE_KEYS.has(key.toLowerCase())) {
                delete current[key];
                changed = true;
            }
            else if (nested && typeof nested === "object") {
                queue.push(nested);
            }
        }
    }
    return changed;
}
function isPlayerApiRequest(url) {
    try {
        const parsed = new URL(url);
        return (parsed.hostname === "youtube.com" || parsed.hostname.endsWith(".youtube.com"))
            && /^\/youtubei\/v1\/(?:player|next)(?:\/|$)/.test(parsed.pathname);
    }
    catch {
        return false;
    }
}
async function stripPlayerAdsFromResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!/json/i.test(contentType))
        return response;
    try {
        const raw = await response.clone().text();
        if (raw.length > 8 * 1024 * 1024)
            return response;
        const payload = JSON.parse(raw);
        if (!stripPlayerAdPayload(payload))
            return response;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        return new Response(JSON.stringify(payload), {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    }
    catch {
        return response;
    }
}
function installAdAndTrackingLayer() {
    if (window.__yoodFilteringInstalled)
        return;
    window.__yoodFilteringInstalled = true;
    const adTokens = ["doubleclick.net", "googleadservices.com", "googlesyndication.com", "adservice.google.com", "jnn-pa.googleapis.com", "youtube.com/api/stats/ads", "youtube.com/pagead", "youtube.com/ptracking", "youtube.com/get_midroll_info", "youtube.com/ad_break"];
    const trackingTokens = [];
    const decisionCache = new Map();
    let cosmeticTimer;
    let cosmeticRequest = 0;
    let lastCosmeticUrl = "";
    const refreshTracking = async () => {
        try {
            const enabled = await invoke("tracking_protection_enabled") === true;
            trackingTokens.length = 0;
            if (enabled)
                trackingTokens.push("google-analytics.com", "googletagmanager.com", "youtube.com/api/stats/qoe");
            decisionCache.clear();
        }
        catch { /* keep the current policy until the next retry */ }
    };
    Object.defineProperty(window, "__yoodRefreshTracking", {
        value: refreshTracking,
        configurable: false,
        writable: false,
    });
    void refreshTracking();
    const requestUrl = (value) => { try {
        return new URL(String(value), location.href).href;
    }
    catch {
        return null;
    } };
    const fastBlocked = (value) => {
        const raw = requestUrl(value);
        if (!raw)
            return false;
        try {
            const url = new URL(raw);
            return [...adTokens, ...trackingTokens].some((token) => url.hostname === token || url.hostname.endsWith(`.${token}`) || url.href.includes(token));
        }
        catch {
            return false;
        }
    };
    const needsEngineCheck = (value) => {
        try {
            const url = new URL(value);
            // Do not delay normal YouTube API, image, and media requests through an
            // IPC round trip.  Those paths are handled by the native layer on Linux;
            // the browser-side engine is reserved for URLs that actually resemble an
            // ad/tracker rule and are not covered by the synchronous mandatory list.
            const candidate = `${url.hostname}${url.pathname}${url.search}`;
            return /(?:^|[./?&=_-])(?:ad|ads|adx|advert(?:isement)?|promoted|sponsor(?:ed)?)(?:$|[./?&=_-])/i.test(candidate);
        }
        catch {
            return false;
        }
    };
    const engineBlocked = async (url, requestType) => {
        const key = `${requestType}:${url}`;
        const cached = decisionCache.get(key);
        if (cached !== undefined)
            return cached;
        try {
            const blocked = await invoke("check_filter_request", { url, source_url: location.href, request_type: requestType }) === true;
            if (decisionCache.size >= 2048)
                decisionCache.delete(decisionCache.keys().next().value);
            decisionCache.set(key, blocked);
            return blocked;
        }
        catch {
            return false;
        }
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input, init) => {
        const url = requestUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url && fastBlocked(url))
            throw new DOMException("Blocked by Yood", "AbortError");
        if (url && needsEngineCheck(url) && await engineBlocked(url, "fetch"))
            throw new DOMException("Blocked by Yood", "AbortError");
        const response = await originalFetch(input, init);
        return url && isPlayerApiRequest(url) ? stripPlayerAdsFromResponse(response) : response;
    });
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = class extends OriginalXHR {
        constructor() {
            super(...arguments);
            this.yoodUrl = "";
            this.yoodGeneration = 0;
            this.yoodCancelled = false;
            this.yoodAsync = true;
        }
        open(method, url, ...rest) {
            this.yoodUrl = requestUrl(url) || "";
            this.yoodGeneration += 1;
            this.yoodCancelled = false;
            this.yoodAsync = rest[0] !== false;
            super.open(method, url.toString(), rest[0] ?? true, rest[1], rest[2]);
        }
        send(body) {
            const generation = this.yoodGeneration;
            const url = this.yoodUrl;
            if (!url) {
                super.send(body);
                return;
            }
            if (fastBlocked(url)) {
                this.abort();
                return;
            }
            if (!this.yoodAsync || !needsEngineCheck(url)) {
                super.send(body);
                return;
            }
            void engineBlocked(url, "xmlhttprequest").then((blocked) => {
                if (generation !== this.yoodGeneration || this.yoodCancelled)
                    return;
                if (blocked) {
                    this.abort();
                    return;
                }
                super.send(body);
            });
        }
        abort() { this.yoodCancelled = true; super.abort(); }
    };
    const updateStyle = (selectors = []) => {
        if (!document.head)
            return;
        let style = document.getElementById("yood-ad-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "yood-ad-style";
            document.head.appendChild(style);
        }
        // Each remote selector gets its own rule.  If YouTube's WebKit does not
        // understand one modern selector (for example :has()), it discards only
        // that rule instead of the entire built-in ad stylesheet.
        style.textContent = `${STATIC_AD_SELECTORS} { display: none !important; }\n${selectors.map((selector) => `${selector} { display: none !important; }`).join("\n")}`;
    };
    const refreshCosmetics = () => {
        cosmeticTimer = undefined;
        if (!/^https?:$/i.test(location.protocol))
            return;
        const pageUrl = location.href;
        const request = ++cosmeticRequest;
        lastCosmeticUrl = pageUrl;
        const classes = new Set();
        const ids = new Set();
        for (const element of Array.from(document.querySelectorAll("[class],[id]")).slice(0, 2500)) {
            element.classList.forEach((value) => classes.add(value));
            if (element.id)
                ids.add(element.id);
        }
        void invoke("get_filter_script_rules", { page_url: pageUrl, classes: [...classes], ids: [...ids] }).then((rules) => {
            if (request !== cosmeticRequest || pageUrl !== location.href)
                return;
            const value = rules;
            const selectors = (value.cosmetic_selectors || []).filter((selector) => typeof selector === "string" && selector.length <= 2048 && !/[{};]/.test(selector));
            updateStyle(selectors);
            removeKnownAds();
        }).catch(() => updateStyle());
    };
    const scheduleCosmetics = (force = false) => {
        if (!force && lastCosmeticUrl === location.href)
            return;
        if (cosmeticTimer === undefined)
            cosmeticTimer = window.setTimeout(refreshCosmetics, 450);
    };
    const installDomLayer = () => {
        updateStyle();
        window.__YOOD_RELEASE_AD_SHIELD__?.();
        window.__YOOD_RELEASE_AD_SHIELD__ = undefined;
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node instanceof Element)
                        removeKnownAds(node);
                }
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
        removeKnownAds();
        scheduleCosmetics(true);
    };
    if (document.head && document.documentElement)
        installDomLayer();
    else
        window.addEventListener("DOMContentLoaded", installDomLayer, { once: true });
    const refreshForNavigation = () => { lastCosmeticUrl = ""; scheduleCosmetics(); };
    window.addEventListener("yt-navigate-finish", refreshForNavigation);
    window.addEventListener("yt-page-data-updated", refreshForNavigation);
}
function installPlayerAdSkip() {
    // Backup layer for in-stream video ads (pre/mid/post-roll). Those segments
    // are served from googlevideo.com — the same CDN as real content — so they
    // can never be blocked by URL. When YouTube still schedules one (the
    // player-response stripping above missed it), fast-forward through it and
    // press Skip the moment YouTube enables it. Nothing here runs unless the
    // player itself reports an ad *and* ad UI is present, so normal playback is
    // never touched. No polling while idle: the interval only lives while an
    // ad is on screen.
    let skipTimer;
    let mutedForAd = false;
    let rateForAd = false;
    const player = () => {
        const node = document.getElementById("movie_player");
        return node && node.isConnected ? node : null;
    };
    const isAdShowing = (node) => node.classList.contains("ad-showing") || node.classList.contains("ad-interrupting");
    const stopTimer = () => {
        if (skipTimer !== undefined) {
            window.clearInterval(skipTimer);
            skipTimer = undefined;
        }
    };
    const restorePlayback = (node) => {
        const video = node.querySelector("video.html5-main-video");
        if (!video)
            return;
        try {
            if (mutedForAd) {
                video.muted = false;
                mutedForAd = false;
            }
            if (rateForAd) {
                video.playbackRate = 1;
                rateForAd = false;
            }
        }
        catch { /* transient state; the ad is gone anyway */ }
    };
    const handleAdFrame = () => {
        const node = player();
        if (!node || !isAdShowing(node)) {
            stopTimer();
            if (node)
                restorePlayback(node);
            return;
        }
        // Second confirmation from actual ad UI before touching anything.
        const skip = node.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-skip-ad-button-modern");
        const overlay = node.querySelector(".ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-message-container, .ytp-ad-skip-button-container");
        if (!skip && !overlay)
            return;
        const video = node.querySelector("video.html5-main-video");
        if (video) {
            try {
                if (!video.muted) {
                    video.muted = true;
                    mutedForAd = true;
                }
                if (video.playbackRate !== 16) {
                    video.playbackRate = 16;
                    rateForAd = true;
                }
                // Unskippable bumper: jump near the end once duration is known.
                // Guarded to short clips so a misdetection can never skip real content.
                if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120
                    && video.currentTime < video.duration - 0.3) {
                    video.currentTime = video.duration - 0.1;
                }
            }
            catch { /* read-only in odd states; next tick retries */ }
        }
        if (skip && skip.offsetParent !== null)
            skip.click();
    };
    const onClassChange = () => {
        const node = player();
        if (!node)
            return;
        if (isAdShowing(node)) {
            handleAdFrame();
            if (skipTimer === undefined)
                skipTimer = window.setInterval(handleAdFrame, 400);
        }
        else {
            stopTimer();
            restorePlayback(node);
        }
    };
    const watch = () => {
        const node = player();
        if (!node)
            return;
        if (node.hasAttribute("data-yood-adwatch")) {
            onClassChange();
            return;
        }
        node.setAttribute("data-yood-adwatch", "");
        new MutationObserver(onClassChange).observe(node, { attributes: true, attributeFilter: ["class"] });
        onClassChange();
    };
    if (document.getElementById("movie_player"))
        watch();
    else
        window.addEventListener("DOMContentLoaded", watch, { once: true });
    // Watch pages mount the player lazily; re-attach after SPA navigations.
    window.addEventListener("yt-navigate-finish", () => window.setTimeout(watch, 600));
}
function installDevtoolsBlock() {
    // Minimal-browser policy: no DevTools / web inspector.
    // The native side is locked with `.devtools(false)` in Rust; this only
    // swallows the inspector keyboard shortcuts so they never reach YouTube
    // or trigger anything in debug builds. Normal browsing keys (Ctrl+L for
    // Yood's URL bar, Shift+D for download) are intentionally left alone.
    document.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (event.key === "F12" || event.code === "F12") {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && ["i", "j", "c", "k", "e"].includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.metaKey && event.altKey && ["i", "j", "c"].includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey && key === "u") {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
}
function install() {
    if (!isYoodPage)
        return;
    if (window.__YOOD__)
        return;
    window.__YOOD__ = { invoke, scan };
    installDevtoolsBlock();
    installYoodControlClickCapture();
    installPlayerAdSkip();
    installWatchLaterDragDrop();
    installMiddleClickWatchLater();
    installAppearance();
    void invoke("get_settings").then((settings) => {
        const shortcut = settings.shortcut_download;
        if (typeof shortcut === "string" && /^[a-z0-9]$/i.test(shortcut)) {
            downloadShortcut = shortcut.toLowerCase();
        }
    }).catch(() => undefined);
    void invoke("get_desktop_environment").then((desktop) => {
        if (["hyprland", "niri", "plasma", "gnome", "other"].includes(String(desktop))) {
            document.documentElement?.setAttribute("data-yood-desktop", String(desktop));
        }
    }).catch(() => undefined);
    let scheduled = false;
    let navigationRetry;
    const schedule = () => { if (scheduled)
        return; scheduled = true; window.setTimeout(() => { scheduled = false; scan(); }, 180); };
    const scheduleForNavigation = () => {
        schedule();
        if (navigationRetry !== undefined)
            window.clearTimeout(navigationRetry);
        // YouTube upgrades several custom elements after its navigation event. A
        // single bounded retry catches that phase without polling the whole DOM.
        navigationRetry = window.setTimeout(schedule, 850);
    };
    ["yt-navigate-finish", "yt-page-data-updated", "popstate", "DOMContentLoaded"].forEach((event) => window.addEventListener(event, scheduleForNavigation));
    const observePage = () => {
        if (document.documentElement) {
            new MutationObserver((records) => {
                for (const record of records) {
                    for (const node of record.addedNodes) {
                        if (needsCardScan(node)) {
                            schedule();
                            return;
                        }
                    }
                }
            }).observe(document.documentElement, { childList: true, subtree: true });
        }
    };
    observePage();
    if (!document.documentElement)
        window.addEventListener("DOMContentLoaded", observePage, { once: true });
    document.addEventListener("keydown", (event) => {
        if (event.shiftKey && event.key.toLowerCase() === downloadShortcut && !/input|textarea|select/i.test(event.target?.tagName || "")) {
            event.preventDefault();
            showDownloadDialog(currentUrl(), "shortcut");
            return;
        }
        // Ctrl+L / Cmd+L opens the URL bar. Matches on the physical key
        // (`code`), not the layout-dependent `key`, so it works under any
        // keyboard layout (e.g. Hebrew). Capture phase so YouTube's own
        // handlers cannot swallow it first.
        const isL = event.code === "KeyL" || event.key.toLowerCase() === "l";
        if ((event.ctrlKey || event.metaKey) && isL) {
            event.preventDefault();
            showUrlBar();
        }
    }, true);
    installAdAndTrackingLayer();
    listenForDownloadUpdates();
    if (document.readyState === "loading")
        window.addEventListener("DOMContentLoaded", scan, { once: true });
    else
        scan();
}
install();
