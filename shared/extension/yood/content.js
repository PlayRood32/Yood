// Yood companion extension (Brave app mode).
// - Alt+L: small floating bar (top center) for YouTube links / IDs.
// - Download buttons inside YouTube's own button rows, with Yood's icon
//   (watch pages AND Shorts).
// - YouTube-styled download dialog: mode, quality, container, subtitles
//   (+language, incl. auto-translate), advanced yt-dlp options.
// - Ad blocking layers (cosmetic + request + player-response + skip):
//   Brave Shields stays on, declarativeNetRequest blocks dedicated ad
//   hosts at the network level (see rules.json); page.js patches YouTube's
//   page-world fetch/XHR, and this script hides ad renderers and skips ads.
// Clicking Download hands everything to the Yood desktop app, which
// downloads via yt-dlp. No data collection, no remote code.
(function () {
  "use strict";
  if (window.__YOOD_EXT__) return;
  window.__YOOD_EXT__ = true;

  var MARK = "data-yood-download";
  var MARK_LATER = "data-yood-watch-later";
  var CARD_SELECTOR = "ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ytd-reel-item-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytmusic-responsive-list-item-renderer, ytmusic-player-queue-item";
  var DOWNLOAD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12.5535 16.5061C12.4114 16.6615 12.2106 16.75 12 16.75C11.7894 16.75 11.5886 16.6615 11.4465 16.5061L7.44648 12.1311C7.16698 11.8254 7.18822 11.351 7.49392 11.0715C7.79963 10.792 8.27402 10.8132 8.55352 11.1189L11.25 14.0682V3C11.25 2.58579 11.5858 2.25 12 2.25C12.4142 2.25 12.75 2.58579 12.75 3V14.0682L15.4465 11.1189C15.726 10.8132 16.2004 10.792 16.5061 11.0715C16.8118 11.351 16.833 11.8254 16.5535 12.1311L12.5535 16.5061Z" fill="currentColor"></path><path d="M3.75 15C3.75 14.5858 3.41422 14.25 3 14.25C2.58579 14.25 2.25 14.5858 2.25 15V15.0549C2.24998 16.4225 2.24996 17.5248 2.36652 18.3918C2.48754 19.2919 2.74643 20.0497 3.34835 20.6516C3.95027 21.2536 4.70814 21.5125 5.60825 21.6335C6.47522 21.75 7.57754 21.75 8.94513 21.75H15.0549C16.4225 21.75 17.5248 21.75 18.3918 21.6335C19.2919 21.5125 20.0497 21.2536 20.6517 20.6516C21.2536 20.0497 21.5125 19.2919 21.6335 18.3918C21.75 17.5248 21.75 16.4225 21.75 15.0549V15C21.75 14.5858 21.4142 14.25 21 14.25C20.5858 14.25 20.25 14.5858 20.25 15C20.25 16.4354 20.2484 17.4365 20.1469 18.1919C20.0482 18.9257 19.8678 19.3142 19.591 19.591C19.3142 19.8678 18.9257 20.0482 18.1919 20.1469C17.4365 20.2484 16.4354 20.25 15 20.25H9C7.56459 20.25 6.56347 20.2484 5.80812 20.1469C5.07435 20.0482 4.68577 19.8678 4.40901 19.591C4.13225 19.3142 3.9518 18.9257 3.85315 18.1919C3.75159 17.4365 3.75 16.4354 3.75 15Z" fill="currentColor"></path></svg>';

  // ---- Yood i18n: labels follow YouTube's own UI language ----
  // Detects YouTube interface language (html lang / hl / navigator) and
  // localises every Yood-owned button/toast. Falls back to English for any
  // language without an explicit table entry.
  var YOOD_I18N = {"en": {"download": "Download", "downloadWith": "Download with Yood", "watchLater": "Watch later", "saved": "✓ Saved", "savedTo": "Saved to Watch later", "removedFrom": "Removed from Watch later", "alreadyIn": "Already in Watch later", "downloadAll": "Download all", "clear": "Clear", "empty": "No videos saved yet", "sent": "Sent to Yood — downloading in the background", "cancel": "Cancel", "playlistTitle": "Download entire playlist", "playlistConfirm": "This will download all {n} videos in this playlist.", "browse": "Browse…", "back": "Back", "forward": "Forward", "close": "Close", "browseFailed": "Could not open folder picker", "saveToFolder": "Save to", "defaultFolder": "Default folder", "downloadDone": "Download finished", "downloadFailed": "Download failed", "statusCompleted": "Completed"}, "he": {"download": "הורדה", "downloadWith": "הורד בעזרת Yood", "watchLater": "צפייה מאוחרת", "saved": "✓ נשמר", "savedTo": "נשמר לצפייה מאוחרת", "removedFrom": "הוסר מהצפייה המאוחרת", "alreadyIn": "כבר נמצא בצפייה מאוחרת", "downloadAll": "הורד הכל", "clear": "נקה", "empty": "עדיין לא נשמרו סרטונים", "sent": "נשלח ל-Yood — מוריד ברקע", "cancel": "ביטול", "playlistTitle": "הורדת הפלייליסט כולו", "playlistConfirm": "פעולה זו תוריד את כל {n} הסרטונים בפלייליסט.", "browse": "עיון…", "back": "חזרה", "forward": "קדימה", "close": "סגירה", "browseFailed": "לא ניתן לפתוח את בורר התיקיות", "saveToFolder": "שמירה לתיקייה", "defaultFolder": "תיקיית ברירת מחדל", "downloadDone": "ההורדה הסתיימה", "downloadFailed": "ההורדה נכשלה", "statusCompleted": "הושלם"}, "iw": {"download": "הורדה", "downloadWith": "הורד בעזרת Yood", "watchLater": "צפייה מאוחרת", "saved": "✓ נשמר", "savedTo": "נשמר לצפייה מאוחרת", "removedFrom": "הוסר מהצפייה המאוחרת", "alreadyIn": "כבר נמצא בצפייה מאוחרת", "downloadAll": "הורד הכל", "clear": "נקה", "empty": "עדיין לא נשמרו סרטונים", "sent": "נשלח ל-Yood — מוריד ברקע", "cancel": "ביטול", "playlistTitle": "הורדת הפלייליסט כולו", "playlistConfirm": "פעולה זו תוריד את כל {n} הסרטונים בפלייליסט.", "browse": "עיון…", "back": "חזרה", "forward": "קדימה", "close": "סגירה", "browseFailed": "לא ניתן לפתוח את בורר התיקיות", "saveToFolder": "שמירה לתיקייה", "defaultFolder": "תיקיית ברירת מחדל", "downloadDone": "ההורדה הסתיימה", "downloadFailed": "ההורדה נכשלה", "statusCompleted": "הושלם"}, "ar": {"download": "تنزيل", "downloadWith": "تنزيل مع Yood", "watchLater": "المشاهدة لاحقاً", "saved": "✓ تم الحفظ", "savedTo": "تم الحفظ للمشاهدة لاحقاً", "removedFrom": "تمت الإزالة من المشاهدة لاحقاً", "alreadyIn": "موجود بالفعل في المشاهدة لاحقاً", "downloadAll": "تنزيل الكل", "clear": "مسح", "empty": "لا توجد مقاطع محفوظة بعد", "sent": "تم الإرسال إلى Yood — جارٍ التنزيل في الخلفية", "cancel": "إلغاء", "playlistTitle": "تنزيل قائمة التشغيل كاملة", "playlistConfirm": "سيؤدي هذا إلى تنزيل جميع مقاطع الفيديو الـ {n} في قائمة التشغيل.", "browse": "استعراض…", "back": "رجوع", "forward": "تقديم", "close": "إغلاق", "browseFailed": "تعذر فتح منتقي المجلدات", "saveToFolder": "حفظ في", "defaultFolder": "المجلد الافتراضي"}, "es": {"download": "Descargar", "downloadWith": "Descargar con Yood", "watchLater": "Ver más tarde", "saved": "✓ Guardado", "savedTo": "Guardado para ver más tarde", "removedFrom": "Eliminado de Ver más tarde", "alreadyIn": "Ya está en Ver más tarde", "downloadAll": "Descargar todo", "clear": "Borrar", "empty": "Aún no hay vídeos guardados", "sent": "Enviado a Yood — descargando en segundo plano", "cancel": "Cancelar", "playlistTitle": "Descargar la playlist completa", "playlistConfirm": "Esto descargará los {n} vídeos de la playlist.", "browse": "Examinar…", "back": "Atrás", "forward": "Adelante", "close": "Cerrar", "browseFailed": "No se pudo abrir el selector de carpetas", "saveToFolder": "Guardar en", "defaultFolder": "Carpeta predeterminada"}, "fr": {"download": "Télécharger", "downloadWith": "Télécharger avec Yood", "watchLater": "À regarder plus tard", "saved": "✓ Enregistré", "savedTo": "Enregistré à regarder plus tard", "removedFrom": "Retiré de À regarder plus tard", "alreadyIn": "Déjà dans À regarder plus tard", "downloadAll": "Tout télécharger", "clear": "Effacer", "empty": "Aucune vidéo enregistrée", "sent": "Envoyé à Yood — téléchargement en arrière-plan", "cancel": "Annuler", "playlistTitle": "Télécharger toute la playlist", "playlistConfirm": "Cela téléchargera les {n} vidéos de la playlist.", "browse": "Parcourir…", "back": "Retour", "forward": "Suivant", "close": "Fermer", "browseFailed": "Impossible d'ouvrir le sélecteur de dossier", "saveToFolder": "Enregistrer dans", "defaultFolder": "Dossier par défaut"}, "de": {"download": "Herunterladen", "downloadWith": "Mit Yood herunterladen", "watchLater": "Später ansehen", "saved": "✓ Gespeichert", "savedTo": "Für Später ansehen gespeichert", "removedFrom": "Aus Später ansehen entfernt", "alreadyIn": "Bereits in Später ansehen", "downloadAll": "Alle herunterladen", "clear": "Löschen", "empty": "Noch keine Videos gespeichert", "sent": "An Yood gesendet — lädt im Hintergrund", "cancel": "Abbrechen", "playlistTitle": "Gesamte Playlist herunterladen", "playlistConfirm": "Dadurch werden alle {n} Videos dieser Playlist heruntergeladen.", "browse": "Durchsuchen…", "back": "Zurück", "forward": "Weiter", "close": "Schließen", "browseFailed": "Ordnerauswahl konnte nicht geöffnet werden", "saveToFolder": "Speichern in", "defaultFolder": "Standardordner"}, "ru": {"download": "Скачать", "downloadWith": "Скачать с Yood", "watchLater": "Смотреть позже", "saved": "✓ Сохранено", "savedTo": "Сохранено в «Смотреть позже»", "removedFrom": "Удалено из «Смотреть позже»", "alreadyIn": "Уже в «Смотреть позже»", "downloadAll": "Скачать все", "clear": "Очистить", "empty": "Пока ничего не сохранено", "sent": "Отправлено в Yood — загрузка в фоне", "cancel": "Отмена", "playlistTitle": "Скачать весь плейлист", "playlistConfirm": "Будут скачаны все {n} видео из этого плейлиста.", "browse": "Обзор…", "back": "Назад", "forward": "Вперёд", "close": "Закрыть", "browseFailed": "Не удалось открыть выбор папки", "saveToFolder": "Сохранить в", "defaultFolder": "Папка по умолчанию"}, "uk": {"download": "Завантажити", "downloadWith": "Завантажити з Yood", "watchLater": "Дивитися пізніше", "saved": "✓ Збережено", "savedTo": "Збережено в «Дивитися пізніше»", "removedFrom": "Вилучено з «Дивитися пізніше»", "alreadyIn": "Уже в «Дивитися пізніше»", "downloadAll": "Завантажити все", "clear": "Очистити", "empty": "Поки нічого не збережено", "sent": "Надіслано в Yood — завантаження у фоні", "cancel": "Скасувати", "playlistTitle": "Завантажити весь плейлист", "playlistConfirm": "Буде завантажено всі {n} відео з цього плейлиста.", "browse": "Огляд…", "back": "Назад", "forward": "Уперед", "close": "Закрити", "browseFailed": "Не вдалося відкрити вибір папки", "saveToFolder": "Зберегти в", "defaultFolder": "Типова папка"}, "pt": {"download": "Baixar", "downloadWith": "Baixar com Yood", "watchLater": "Ver mais tarde", "saved": "✓ Salvo", "savedTo": "Salvo em Ver mais tarde", "removedFrom": "Removido de Ver mais tarde", "alreadyIn": "Já está em Ver mais tarde", "downloadAll": "Baixar tudo", "clear": "Limpar", "empty": "Nenhum vídeo salvo ainda", "sent": "Enviado para o Yood — baixando em segundo plano", "cancel": "Cancelar", "playlistTitle": "Baixar a playlist inteira", "playlistConfirm": "Isto baixará todos os {n} vídeos desta playlist.", "browse": "Procurar…", "back": "Voltar", "forward": "Avançar", "close": "Fechar", "browseFailed": "Não foi possível abrir o seletor de pastas", "saveToFolder": "Salvar em", "defaultFolder": "Pasta padrão"}, "it": {"download": "Scarica", "downloadWith": "Scarica con Yood", "watchLater": "Guarda dopo", "saved": "✓ Salvato", "savedTo": "Salvato in Guarda dopo", "removedFrom": "Rimosso da Guarda dopo", "alreadyIn": "Già in Guarda dopo", "downloadAll": "Scarica tutto", "clear": "Cancella", "empty": "Nessun video salvato", "sent": "Inviato a Yood — download in background", "cancel": "Annulla", "playlistTitle": "Scarica l'intera playlist", "playlistConfirm": "Verranno scaricati tutti i {n} video di questa playlist.", "browse": "Sfoglia…", "back": "Indietro", "forward": "Avanti", "close": "Chiudi", "browseFailed": "Impossibile aprire il selettore cartelle", "saveToFolder": "Salva in", "defaultFolder": "Cartella predefinita"}, "nl": {"download": "Downloaden", "downloadWith": "Downloaden met Yood", "watchLater": "Later bekijken", "saved": "✓ Opgeslagen", "savedTo": "Opgeslagen voor Later bekijken", "removedFrom": "Verwijderd uit Later bekijken", "alreadyIn": "Staat al in Later bekijken", "downloadAll": "Alles downloaden", "clear": "Wissen", "empty": "Nog geen video's opgeslagen", "sent": "Naar Yood gestuurd — downloadt op de achtergrond", "cancel": "Annuleren", "playlistTitle": "Volledige afspeellijst downloaden", "playlistConfirm": "Hiermee worden alle {n} video's in deze afspeellijst gedownload.", "browse": "Bladeren…", "back": "Terug", "forward": "Vooruit", "close": "Sluiten", "browseFailed": "Kon mappenkiezer niet openen", "saveToFolder": "Opslaan in", "defaultFolder": "Standaardmap"}, "pl": {"download": "Pobierz", "downloadWith": "Pobierz z Yood", "watchLater": "Obejrzyj później", "saved": "✓ Zapisano", "savedTo": "Zapisano do Obejrzyj później", "removedFrom": "Usunięto z Obejrzyj później", "alreadyIn": "Już jest w Obejrzyj później", "downloadAll": "Pobierz wszystko", "clear": "Wyczyść", "empty": "Brak zapisanych filmów", "sent": "Wysłano do Yood — pobieranie w tle", "cancel": "Anuluj", "playlistTitle": "Pobierz całą playlistę", "playlistConfirm": "Spowoduje to pobranie wszystkich {n} filmów z tej playlisty.", "browse": "Przeglądaj…", "back": "Wstecz", "forward": "Dalej", "close": "Zamknij", "browseFailed": "Nie można otworzyć wyboru folderu", "saveToFolder": "Zapisz w", "defaultFolder": "Domyślny folder"}, "tr": {"download": "İndir", "downloadWith": "Yood ile indir", "watchLater": "Daha sonra izle", "saved": "✓ Kaydedildi", "savedTo": "Daha sonra izle listesine kaydedildi", "removedFrom": "Daha sonra izle listesinden çıkarıldı", "alreadyIn": "Zaten Daha sonra izle'de", "downloadAll": "Tümünü indir", "clear": "Temizle", "empty": "Henüz kaydedilen video yok", "sent": "Yood'a gönderildi — arka planda indiriliyor", "cancel": "İptal", "playlistTitle": "Çalma listesinin tamamını indir", "playlistConfirm": "Bu listedeki {n} videonun tamamı indirilecek.", "browse": "Gözat…", "back": "Geri", "forward": "İleri", "close": "Kapat", "browseFailed": "Klasör seçici açılamadı", "saveToFolder": "Şuraya kaydet", "defaultFolder": "Varsayılan klasör"}, "hi": {"download": "डाउनलोड", "downloadWith": "Yood के साथ डाउनलोड", "watchLater": "बाद में देखें", "saved": "✓ सहेजा गया", "savedTo": "बाद में देखने के लिए सहेजा गया", "removedFrom": "बाद में देखने से हटाया गया", "alreadyIn": "पहले से बाद में देखने में है", "downloadAll": "सभी डाउनलोड करें", "clear": "साफ़ करें", "empty": "अभी कोई वीडियो सहेजा नहीं गया", "sent": "Yood को भेजा गया — बैकग्राउंड में डाउनलोड हो रहा है", "cancel": "रद्द करें", "playlistTitle": "पूरी प्लेलिस्ट डाउनलोड करें", "playlistConfirm": "इससे इस प्लेलिस्ट के सभी {n} वीडियो डाउनलोड होंगे।", "browse": "ब्राउज़ करें…", "back": "पीछे", "forward": "आगे", "close": "बंद करें", "browseFailed": "फ़ोल्डर चयनकर्ता नहीं खोला जा सका", "saveToFolder": "इसमें सहेजें", "defaultFolder": "डिफ़ॉल्ट फ़ोल्डर"}, "ja": {"download": "ダウンロード", "downloadWith": "Yoodでダウンロード", "watchLater": "後で見る", "saved": "✓ 保存済み", "savedTo": "「後で見る」に保存しました", "removedFrom": "「後で見る」から削除しました", "alreadyIn": "既に「後で見る」にあります", "downloadAll": "すべてダウンロード", "clear": "クリア", "empty": "保存された動画はまだありません", "sent": "Yoodに送信しました — バックグラウンドでダウンロード中", "cancel": "キャンセル", "playlistTitle": "プレイリスト全体をダウンロード", "playlistConfirm": "このプレイリストの{n}本の動画すべてをダウンロードします。", "browse": "参照…", "back": "戻る", "forward": "進む", "close": "閉じる", "browseFailed": "フォルダ選択を開けませんでした", "saveToFolder": "保存先", "defaultFolder": "既定のフォルダ"}, "ko": {"download": "다운로드", "downloadWith": "Yood로 다운로드", "watchLater": "나중에 볼 동영상", "saved": "✓ 저장됨", "savedTo": "나중에 볼 동영상에 저장됨", "removedFrom": "나중에 볼 동영상에서 삭제됨", "alreadyIn": "이미 나중에 볼 동영상에 있음", "downloadAll": "모두 다운로드", "clear": "지우기", "empty": "저장된 동영상이 없습니다", "sent": "Yood로 전송됨 — 백그라운드에서 다운로드 중", "cancel": "취소", "playlistTitle": "재생목록 전체 다운로드", "playlistConfirm": "이 재생목록의 동영상 {n}개를 모두 다운로드합니다.", "browse": "찾아보기…", "back": "뒤로", "forward": "앞으로", "close": "닫기", "browseFailed": "폴더 선택기를 열 수 없습니다", "saveToFolder": "저장 위치", "defaultFolder": "기본 폴더"}, "zh": {"download": "下载", "downloadWith": "用 Yood 下载", "watchLater": "稍后观看", "saved": "✓ 已保存", "savedTo": "已保存到稍后观看", "removedFrom": "已从稍后观看中移除", "alreadyIn": "已在稍后观看中", "downloadAll": "下载全部", "clear": "清空", "empty": "还没有保存的视频", "sent": "已发送到 Yood — 正在后台下载", "cancel": "取消", "playlistTitle": "下载整个播放列表", "playlistConfirm": "这将下载此播放列表中的全部 {n} 个视频。", "browse": "浏览…", "back": "返回", "forward": "前进", "close": "关闭", "browseFailed": "无法打开文件夹选择器", "saveToFolder": "保存到", "defaultFolder": "默认文件夹"}, "zh-cn": {"download": "下载", "downloadWith": "用 Yood 下载", "watchLater": "稍后观看", "saved": "✓ 已保存", "savedTo": "已保存到稍后观看", "removedFrom": "已从稍后观看中移除", "alreadyIn": "已在稍后观看中", "downloadAll": "下载全部", "clear": "清空", "empty": "还没有保存的视频", "sent": "已发送到 Yood — 正在后台下载", "cancel": "取消", "playlistTitle": "下载整个播放列表", "playlistConfirm": "这将下载此播放列表中的全部 {n} 个视频。", "browse": "浏览…", "back": "返回", "forward": "前进", "close": "关闭", "browseFailed": "无法打开文件夹选择器", "saveToFolder": "保存到", "defaultFolder": "默认文件夹"}, "zh-tw": {"download": "下載", "downloadWith": "用 Yood 下載", "watchLater": "稍後觀看", "saved": "✓ 已儲存", "savedTo": "已儲存到稍後觀看", "removedFrom": "已從稍後觀看中移除", "alreadyIn": "已在稍後觀看中", "downloadAll": "下載全部", "clear": "清除", "empty": "尚未儲存影片", "sent": "已傳送到 Yood — 正在背景下載", "cancel": "取消", "playlistTitle": "下載整個播放清單", "playlistConfirm": "這將下載此播放清單中的全部 {n} 部影片。", "browse": "瀏覽…", "back": "返回", "forward": "前進", "close": "關閉", "browseFailed": "無法開啟資料夾選擇器", "saveToFolder": "儲存至", "defaultFolder": "預設資料夾"}, "zh-hk": {"download": "下載", "downloadWith": "用 Yood 下載", "watchLater": "稍後觀看", "saved": "✓ 已儲存", "savedTo": "已儲存到稍後觀看", "removedFrom": "已從稍後觀看中移除", "alreadyIn": "已在稍後觀看中", "downloadAll": "下載全部", "clear": "清除", "empty": "尚未儲存影片", "sent": "已傳送到 Yood — 正在背景下載", "cancel": "取消", "playlistTitle": "下載整個播放清單", "playlistConfirm": "這將下載此播放清單中的全部 {n} 部影片。", "browse": "瀏覽…", "back": "返回", "forward": "前進", "close": "關閉", "browseFailed": "無法開啟資料夾選擇器", "saveToFolder": "儲存至", "defaultFolder": "預設資料夾"}, "fa": {"download": "دانلود", "downloadWith": "دانلود با Yood", "watchLater": "تماشا بعداً", "saved": "✓ ذخیره شد", "savedTo": "در تماشا بعداً ذخیره شد", "removedFrom": "از تماشا بعداً حذف شد", "alreadyIn": "قبلاً در تماشا بعداً هست", "downloadAll": "دانلود همه", "clear": "پاک کردن", "empty": "هنوز ویدیویی ذخیره نشده", "sent": "به Yood ارسال شد — در پس‌زمینه دانلود می‌شود", "cancel": "لغو", "playlistTitle": "دانلود کل لیست پخش", "playlistConfirm": "این کار هر {n} ویدیوی این لیست پخش را دانلود می‌کند.", "browse": "مرور…", "back": "قبلی", "forward": "بعدی", "close": "بستن", "browseFailed": "امکان باز کردن انتخابگر پوشه وجود ندارد", "saveToFolder": "ذخیره در", "defaultFolder": "پوشه پیش‌فرض"}, "id": {"download": "Unduh", "downloadWith": "Unduh dengan Yood", "watchLater": "Tonton nanti", "saved": "✓ Disimpan", "savedTo": "Disimpan ke Tonton nanti", "removedFrom": "Dihapus dari Tonton nanti", "alreadyIn": "Sudah ada di Tonton nanti", "downloadAll": "Unduh semua", "clear": "Hapus", "empty": "Belum ada video tersimpan", "sent": "Dikirim ke Yood — mengunduh di latar", "cancel": "Batal", "playlistTitle": "Unduh seluruh playlist", "playlistConfirm": "Ini akan mengunduh semua {n} video dalam playlist ini.", "browse": "Telusuri…", "back": "Kembali", "forward": "Maju", "close": "Tutup", "browseFailed": "Tidak dapat membuka pemilih folder", "saveToFolder": "Simpan ke", "defaultFolder": "Folder default"}, "cs": {"download": "Stáhnout", "downloadWith": "Stáhnout s Yood", "watchLater": "Přehrát později", "saved": "✓ Uloženo", "savedTo": "Uloženo do Přehrát později", "removedFrom": "Odebráno z Přehrát později", "alreadyIn": "Již v Přehrát později", "downloadAll": "Stáhnout vše", "clear": "Vymazat", "empty": "Zatím žádná uložená videa", "sent": "Odesláno do Yood — stahuje se na pozadí", "cancel": "Zrušit", "playlistTitle": "Stáhnout celý playlist", "playlistConfirm": "Stáhnou se všechna {n} videa v tomto playlistu.", "browse": "Procházet…", "back": "Zpět", "forward": "Vpřed", "close": "Zavřít", "browseFailed": "Nepodařilo se otevřít výběr složky", "saveToFolder": "Uložit do", "defaultFolder": "Výchozí složka"}, "ro": {"download": "Descarcă", "downloadWith": "Descarcă cu Yood", "watchLater": "Vizionează mai târziu", "saved": "✓ Salvat", "savedTo": "Salvat în Vizionează mai târziu", "removedFrom": "Eliminat din Vizionează mai târziu", "alreadyIn": "Deja în Vizionează mai târziu", "downloadAll": "Descarcă tot", "clear": "Șterge", "empty": "Niciun videoclip salvat încă", "sent": "Trimis la Yood — se descarcă în fundal", "cancel": "Anulează", "playlistTitle": "Descarcă tot playlistul", "playlistConfirm": "Se vor descărca toate cele {n} videoclipuri din acest playlist.", "browse": "Răsfoiește…", "back": "Înapoi", "forward": "Înainte", "close": "Închide", "browseFailed": "Nu s-a putut deschide selectorul de foldere", "saveToFolder": "Salvează în", "defaultFolder": "Dosarul implicit"}, "hu": {"download": "Letöltés", "downloadWith": "Letöltés Yooddal", "watchLater": "Később megnézem", "saved": "✓ Mentve", "savedTo": "Mentve a Később listába", "removedFrom": "Eltávolítva a Később listából", "alreadyIn": "Már a Később listában van", "downloadAll": "Összes letöltése", "clear": "Törlés", "empty": "Még nincs mentett videó", "sent": "Elküldve Yoodnak — letöltés a háttérben", "cancel": "Mégse", "playlistTitle": "Teljes lejátszási lista letöltése", "playlistConfirm": "Ez letölti a lejátszási lista összes {n} videóját.", "browse": "Tallózás…", "back": "Vissza", "forward": "Előre", "close": "Bezárás", "browseFailed": "Nem sikerült megnyitni a mappaválasztót", "saveToFolder": "Mentés ide", "defaultFolder": "Alapért mappa"}, "el": {"download": "Λήψη", "downloadWith": "Λήψη με Yood", "watchLater": "Να δω αργότερα", "saved": "✓ Αποθηκεύτηκε", "savedTo": "Αποθηκεύτηκε στο Να δω αργότερα", "removedFrom": "Καταργήθηκε από Να δω αργότερα", "alreadyIn": "Ήδη στο Να δω αργότερα", "downloadAll": "Λήψη όλων", "clear": "Εκκαθάριση", "empty": "Δεν υπάρχουν αποθηκευμένα βίντεο", "sent": "Στάλθηκε στο Yood — λήψη στο παρασκήνιο", "cancel": "Άκυρο", "playlistTitle": "Λήψη ολόκληρης της λίστας", "playlistConfirm": "Θα γίνει λήψη όλων των {n} βίντεο αυτής της λίστας.", "browse": "Αναζήτηση…", "back": "Πίσω", "forward": "Εμπρός", "close": "Κλείσιμο", "browseFailed": "Δεν ήταν δυνατό το άνοιγμα της επιλογής φακέλου", "saveToFolder": "Αποθήκευση σε", "defaultFolder": "Προεπιλεγμένος φάκελος"}, "sv": {"download": "Ladda ned", "downloadWith": "Ladda ned med Yood", "watchLater": "Titta senare", "saved": "✓ Sparad", "savedTo": "Sparad i Titta senare", "removedFrom": "Borttagen från Titta senare", "alreadyIn": "Finns redan i Titta senare", "downloadAll": "Ladda ned alla", "clear": "Rensa", "empty": "Inga sparade videor ännu", "sent": "Skickat till Yood — laddar ned i bakgrunden", "cancel": "Avbryt", "playlistTitle": "Ladda ned hela spellistan", "playlistConfirm": "Detta laddar ned alla {n} videor i spellistan.", "browse": "Bläddra…", "back": "Tillbaka", "forward": "Framåt", "close": "Stäng", "browseFailed": "Kunde inte öppna mappväljaren", "saveToFolder": "Spara i", "defaultFolder": "Standardmapp"}, "da": {"download": "Download", "downloadWith": "Download med Yood", "watchLater": "Se senere", "saved": "✓ Gemt", "savedTo": "Gemt til Se senere", "removedFrom": "Fjernet fra Se senere", "alreadyIn": "Allerede i Se senere", "downloadAll": "Download alle", "clear": "Ryd", "empty": "Ingen gemte videoer endnu", "sent": "Sendt til Yood — downloader i baggrunden", "cancel": "Annuller", "playlistTitle": "Download hele playlisten", "playlistConfirm": "Dette downloader alle {n} videoer på playlisten.", "browse": "Gennemse…", "back": "Tilbage", "forward": "Fremad", "close": "Luk", "browseFailed": "Kunne ikke åbne mappevælgeren", "saveToFolder": "Gem i", "defaultFolder": "Standardmappe"}, "fi": {"download": "Lataa", "downloadWith": "Lataa Yoodilla", "watchLater": "Katso myöhemmin", "saved": "✓ Tallennettu", "savedTo": "Tallennettu Katsottavaksi myöhemmin", "removedFrom": "Poistettu Katsottavaksi myöhemmin", "alreadyIn": "Jo Katsottavaksi myöhemmin -listalla", "downloadAll": "Lataa kaikki", "clear": "Tyhjennä", "empty": "Ei tallennettuja videoita", "sent": "Lähetetty Yoodiin — ladataan taustalla", "cancel": "Peruuta", "playlistTitle": "Lataa koko soittolista", "playlistConfirm": "Tämä lataa soittolistan kaikki {n} videota.", "browse": "Selaa…", "back": "Takaisin", "forward": "Eteenpäin", "close": "Sulje", "browseFailed": "Kansionvalitsinta ei voitu avata", "saveToFolder": "Tallenna kohteeseen", "defaultFolder": "Oletuskansio"}, "no": {"download": "Last ned", "downloadWith": "Last ned med Yood", "watchLater": "Se senere", "saved": "✓ Lagret", "savedTo": "Lagret i Se senere", "removedFrom": "Fjernet fra Se senere", "alreadyIn": "Finnes allerede i Se senere", "downloadAll": "Last ned alle", "clear": "Tøm", "empty": "Ingen lagrede videoer ennå", "sent": "Sendt til Yood — laster ned i bakgrunnen", "cancel": "Avbryt", "playlistTitle": "Last ned hele spillelisten", "playlistConfirm": "Dette laster ned alle {n} videoene i spillelisten.", "browse": "Bla gjennom…", "back": "Tilbake", "forward": "Framover", "close": "Lukk", "browseFailed": "Kunne ikke åpne mappevelgeren", "saveToFolder": "Lagre i", "defaultFolder": "Standardmappe"}, "th": {"download": "ดาวน์โหลด", "downloadWith": "ดาวน์โหลดด้วย Yood", "watchLater": "ดูภายหลัง", "saved": "✓ บันทึกแล้ว", "savedTo": "บันทึกแล้ว ดูภายหลัง", "removedFrom": "ลบออก ดูภายหลัง", "alreadyIn": "อยู่ใน ดูภายหลัง", "downloadAll": "ดาวน์โหลดทั้งหมด", "clear": "ล้าง", "empty": "ยังไม่มีวิดีโอที่บันทึก", "sent": "ส่งไป Yood แล้ว — กำลังดาวน์โหลดอยู่เบื้องหลัง", "cancel": "ยกเลิก", "playlistTitle": "ดาวน์โหลดเพลย์ลิสต์ทั้งหมด", "playlistConfirm": "การดำเนินการนี้จะดาวน์โหลดวิดีโอทั้งหมด {n} รายการในเพลย์ลิสต์", "browse": "เรียกดู…", "back": "ย้อนกลับ", "forward": "ไปข้างหน้า", "close": "ปิด", "browseFailed": "ไม่สามารถเปิดตัวเลือกโฟลเดอร์ได้", "saveToFolder": "บันทึกไปที่", "defaultFolder": "โฟลเดอร์เริ่มต้น"}, "vi": {"download": "Tải xuống", "downloadWith": "Tải xuống với Yood", "watchLater": "Xem sau", "saved": "✓ Đã lưu", "savedTo": "Đã lưu vào Xem sau", "removedFrom": "Đã xóa khỏi Xem sau", "alreadyIn": "Đã có trong Xem sau", "downloadAll": "Tải tất cả", "clear": "Xóa", "empty": "Chưa có video nào được lưu", "sent": "Đã gửi tới Yood — đang tải trong nền", "cancel": "Hủy", "playlistTitle": "Tải toàn bộ danh sách phát", "playlistConfirm": "Thao tác này sẽ tải tất cả {n} video trong danh sách phát.", "browse": "Duyệt…", "back": "Quay lại", "forward": "Tiếp tục", "close": "Đóng", "browseFailed": "Không thể mở trình chọn thư mục", "saveToFolder": "Lưu vào", "defaultFolder": "Thư mục mặc định"}, "ms": {"download": "Muat turun", "downloadWith": "Muat turun dengan Yood", "watchLater": "Tonton kemudian", "saved": "✓ Disimpan", "savedTo": "Disimpan ke Tonton kemudian", "removedFrom": "Dibuang dari Tonton kemudian", "alreadyIn": "Sudah ada dalam Tonton kemudian", "downloadAll": "Muat turun semua", "clear": "Padam", "empty": "Tiada video disimpan lagi", "sent": "Dihantar ke Yood — memuat turun di latar", "cancel": "Batal", "playlistTitle": "Muat turun keseluruhan senarai main", "playlistConfirm": "Ini akan memuat turun kesemua {n} video dalam senarai main ini.", "browse": "Semak imbas…", "back": "Kembali", "forward": "Maju", "close": "Tutup", "browseFailed": "Tidak dapat membuka pemilih folder", "saveToFolder": "Simpan ke", "defaultFolder": "Folder lalai"}, "ca": {"download": "Baixa", "downloadWith": "Baixa amb Yood", "watchLater": "Mira-ho més tard", "saved": "✓ Desat", "savedTo": "Desat per mirar-ho més tard", "removedFrom": "Eliminat de Mira-ho més tard", "alreadyIn": "Ja és a Mira-ho més tard", "downloadAll": "Baixa-ho tot", "clear": "Esborra", "empty": "Encara no hi ha vídeos desats", "sent": "Enviat a Yood — baixant en segon pla", "cancel": "Cancel·la", "playlistTitle": "Baixa la playlist sencera", "playlistConfirm": "Això baixarà els {n} vídeos de la playlist.", "browse": "Examina…", "back": "Enrere", "forward": "Endavant", "close": "Tanca", "browseFailed": "No s'ha pogut obrir el selector de carpetes", "saveToFolder": "Desa a", "defaultFolder": "Carpeta per defecte"}, "hr": {"download": "Preuzmi", "downloadWith": "Preuzmi s Yood", "watchLater": "Pogledaj kasnije", "saved": "✓ Spremljeno", "savedTo": "Spremljeno u Pogledaj kasnije", "removedFrom": "Uklonjeno iz Pogledaj kasnije", "alreadyIn": "Već u Pogledaj kasnije", "downloadAll": "Preuzmi sve", "clear": "Očisti", "empty": "Još nema spremljenih videozapisa", "sent": "Poslano u Yood — preuzima se u pozadini", "cancel": "Odustani", "playlistTitle": "Preuzmi cijeli popis", "playlistConfirm": "Time će se preuzeti svih {n} videozapisa s popisa.", "browse": "Pregledaj…", "back": "Natrag", "forward": "Naprijed", "close": "Zatvori", "browseFailed": "Nije moguće otvoriti odabir mape", "saveToFolder": "Spremi u", "defaultFolder": "Zadana mapa"}, "sk": {"download": "Stiahnuť", "downloadWith": "Stiahnuť s Yood", "watchLater": "Prehrať neskôr", "saved": "✓ Uložené", "savedTo": "Uložené do Prehrať neskôr", "removedFrom": "Odobrané z Prehrať neskôr", "alreadyIn": "Už v Prehrať neskôr", "downloadAll": "Stiahnuť všetko", "clear": "Vymazať", "empty": "Zatiaľ žiadne uložené videá", "sent": "Odoslané do Yood — sťahuje sa na pozadí", "cancel": "Zrušiť", "playlistTitle": "Stiahnuť celý playlist", "playlistConfirm": "Stiahne sa všetkých {n} videí v tomto playliste.", "browse": "Prehľadávať…", "back": "Späť", "forward": "Vpred", "close": "Zavrieť", "browseFailed": "Nepodarilo sa otvoriť výber priečinka", "saveToFolder": "Uložiť do", "defaultFolder": "Predvolený priečinok"}, "sl": {"download": "Prenesi", "downloadWith": "Prenesi z Yood", "watchLater": "Poglej pozneje", "saved": "✓ Shranjeno", "savedTo": "Shranjeno v Poglej pozneje", "removedFrom": "Odstranjeno iz Poglej pozneje", "alreadyIn": "Že v Poglej pozneje", "downloadAll": "Prenesi vse", "clear": "Počisti", "empty": "Še ni shranjenih videoposnetkov", "sent": "Poslano v Yood — prenaša se v ozadju", "cancel": "Prekliči", "playlistTitle": "Prenesi celoten seznam", "playlistConfirm": "To bo preneslo vseh {n} videoposnetkov s tega seznama.", "browse": "Prebrskaj…", "back": "Nazaj", "forward": "Naprej", "close": "Zapri", "browseFailed": "Ni mogoče odpreti izbirnika mape", "saveToFolder": "Shrani v", "defaultFolder": "Privzeta mapa"}, "sr": {"download": "Preuzmi", "downloadWith": "Preuzmi sa Yood", "watchLater": "Pogledaj kasnije", "saved": "✓ Sačuvano", "savedTo": "Sačuvano u Pogledaj kasnije", "removedFrom": "Uklonjeno iz Pogledaj kasnije", "alreadyIn": "Već u Pogledaj kasnije", "downloadAll": "Preuzmi sve", "clear": "Obriši", "empty": "Još nema sačuvanih videozapisa", "sent": "Poslato u Yood — preuzima se u pozadini", "cancel": "Otkaži", "playlistTitle": "Preuzmi celu plejlistu", "playlistConfirm": "Time će se preuzeti svih {n} videozapisa sa plejliste.", "browse": "Potraži…", "back": "Nazad", "forward": "Napred", "close": "Zatvori", "browseFailed": "Nije moguće otvoriti izbor fascikle", "saveToFolder": "Sačuvaj u", "defaultFolder": "Podrazumevana fascikla"}, "bg": {"download": "Изтегли", "downloadWith": "Изтегли с Yood", "watchLater": "Гледай по-късно", "saved": "✓ Запазено", "savedTo": "Запазено в Гледай по-късно", "removedFrom": "Премахнато от Гледай по-късно", "alreadyIn": "Вече в Гледай по-късно", "downloadAll": "Изтегли всичко", "clear": "Изчисти", "empty": "Все още няма запазени видеа", "sent": "Изпратено към Yood — изтегля се във фона", "cancel": "Отказ", "playlistTitle": "Изтегли целия плейлист", "playlistConfirm": "Това ще изтегли всички {n} видеа от този плейлист.", "browse": "Преглед…", "back": "Назад", "forward": "Напред", "close": "Затвори", "browseFailed": "Неуспешно отваряне на избора на папка", "saveToFolder": "Запази в", "defaultFolder": "Папка по подразбиране"}, "lt": {"download": "Atsisiųsti", "downloadWith": "Atsisiųsti su Yood", "watchLater": "Žiūrėti vėliau", "saved": "✓ Išsaugota", "savedTo": "Išsaugota į Žiūrėti vėliau", "removedFrom": "Pašalinta iš Žiūrėti vėliau", "alreadyIn": "Jau yra Žiūrėti vėliau", "downloadAll": "Atsisiųsti viską", "clear": "Išvalyti", "empty": "Dar nėra išsaugotų vaizdo įrašų", "sent": "Išsiųsta į Yood — atsisiunčiama fone", "cancel": "Atšaukti", "playlistTitle": "Atsisiųsti visą grojaraštį", "playlistConfirm": "Bus atsisiųsti visi {n} šio grojaraščio vaizdo įrašai.", "browse": "Naršyti…", "back": "Atgal", "forward": "Pirmyn", "close": "Uždaryti", "browseFailed": "Nepavyko atidaryti aplanko pasirinkimo", "saveToFolder": "Įrašyti į", "defaultFolder": "Numatytasis aplankas"}, "lv": {"download": "Lejupielādēt", "downloadWith": "Lejupielādēt ar Yood", "watchLater": "Skatīties vēlāk", "saved": "✓ Saglabāts", "savedTo": "Saglabāts sadaļā Skatīties vēlāk", "removedFrom": "Noņemts no Skatīties vēlāk", "alreadyIn": "Jau ir sadaļā Skatīties vēlāk", "downloadAll": "Lejupielādēt visu", "clear": "Notīrīt", "empty": "Vēl nav saglabātu videoklipu", "sent": "Nosūtīts uz Yood — lejupielādē fonā", "cancel": "Atcelt", "playlistTitle": "Lejupielādēt visu atskaņošanas sarakstu", "playlistConfirm": "Tiks lejupielādēti visi {n} šī saraksta videoklipi.", "browse": "Pārlūkot…", "back": "Atpakaļ", "forward": "Uz priekšu", "close": "Aizvērt", "browseFailed": "Neizdevās atvērt mapes izvēli", "saveToFolder": "Saglabāt mapē", "defaultFolder": "Noklusējuma mape"}, "et": {"download": "Laadi alla", "downloadWith": "Laadi alla Yoodiga", "watchLater": "Vaata hiljem", "saved": "✓ Salvestatud", "savedTo": "Salvestatud hiljem vaatamiseks", "removedFrom": "Eemaldatud hiljem vaatamise alt", "alreadyIn": "Juba hiljem vaatamise all", "downloadAll": "Laadi kõik alla", "clear": "Tühjenda", "empty": "Salvestatud videoid veel pole", "sent": "Saadetud Yoodi — laadib taustal alla", "cancel": "Loobu", "playlistTitle": "Laadi alla terve esitusloend", "playlistConfirm": "See laadib alla esitusloendi kõik {n} videot.", "browse": "Sirvi…", "back": "Tagasi", "forward": "Edasi", "close": "Sulge", "browseFailed": "Kaustavalijat ei saanud avada", "saveToFolder": "Salvesta kausta", "defaultFolder": "Vaikekaust"}, "az": {"download": "Yüklə", "downloadWith": "Yood ilə yüklə", "watchLater": "Daha sonra izlə", "saved": "✓ Saxlanıldı", "savedTo": "Daha sonra izlə siyahısına saxlanıldı", "removedFrom": "Daha sonra izlə siyahısından silindi", "alreadyIn": "Artıq Daha sonra izlə-dədir", "downloadAll": "Hamısını yüklə", "clear": "Təmizlə", "empty": "Hələ saxlanılan video yoxdur", "sent": "Yood-a göndərildi — arxa planda yüklənir", "cancel": "Ləğv et", "playlistTitle": "Bütün pleylisti yüklə", "playlistConfirm": "Bu, pleylistdəki {n} videonun hamısını yükləyəcək.", "browse": "Gözdən keçir…", "back": "Geri", "forward": "İrəli", "close": "Bağla", "browseFailed": "Qovluq seçici açıla bilmədi", "saveToFolder": "Saxla", "defaultFolder": "Varsayılan qovluq"}, "kk": {"download": "Жүктеп алы", "downloadWith": "Yood арқылы жүктеп алы", "watchLater": "Кейінірек көру", "saved": "✓ Сақталды", "savedTo": "Кейінірек көруге сақталды", "removedFrom": "Кейінірек көруден жойылды", "alreadyIn": "Кейінірек көруде бар", "downloadAll": "Барлығын жүктеп алы", "clear": "Тазарту", "empty": "Әлі сақталған бейне жоқ", "sent": "Yood-ға жіберілді — фонда жүктелуде", "cancel": "Бас тарту", "playlistTitle": "Бүкіл плейлисті жүктеп ал", "playlistConfirm": "Бұл плейлисттегі барлық {n} бейне жүктеледі.", "browse": "Шолу…", "back": "Артқа", "forward": "Алға", "close": "Жабу", "browseFailed": "Қалта таңдау мүмкін болмады", "saveToFolder": "Сақтау", "defaultFolder": "Әдепкі қалта"}, "af": {"download": "Aflaai", "downloadWith": "Aflaai met Yood", "watchLater": "Kyk later", "saved": "✓ Gestoor", "savedTo": "Gestoor om later te kyk", "removedFrom": "Verwyder van Kyk later", "alreadyIn": "Reeds in Kyk later", "downloadAll": "Laai alles af", "clear": "Maak skoon", "empty": "Nog geen video's gestoor nie", "sent": "Gestuur na Yood — laai in die agtergrond af", "cancel": "Kanselleer", "playlistTitle": "Laai hele snitlys af", "playlistConfirm": "Dit sal al {n} video's in hierdie snitlys aflaai.", "browse": "Blaai…", "back": "Terug", "forward": "Vorentoe", "close": "Maak toe", "browseFailed": "Kon gidskeuse nie oopmaak nie", "saveToFolder": "Stoor in", "defaultFolder": "Verstekgids"}, "am": {"download": "አውርድ", "downloadWith": "በYood አውርድ", "watchLater": "በኋላ ተመልከት", "saved": "✓ ተቀምጧል", "savedTo": "በኋላ ለመመልከት ተቀምጧል", "removedFrom": "ከኋላ ተመልከት ተሰርዟል", "alreadyIn": "አስቀድሞ በኋላ ተመልከት ውስጥ አለ", "downloadAll": "ሁሉንም አውርድ", "clear": "አጽዳ", "empty": "እስካሁን ምንም ቪዲዮ አልተቀመጠም", "sent": "ወደ Yood ተልኳል — በጀርባ እያወረደ ነው", "cancel": "ሰርዝ", "playlistTitle": "ሙሉ ዝርዝሩን አውርድ", "playlistConfirm": "ይህ በዚህ ዝርዝር ውስጥ ያሉ {n} ቪዲዮዎች ሁሉ ያወርዳል።", "browse": "አስስ…", "back": "ተመለስ", "forward": "ወደፊት", "close": "ዝጋ", "browseFailed": "የአቃፊ መራጭ መክፈት አልተቻለም", "saveToFolder": "አስቀምጥ በ", "defaultFolder": "ነባሪ አቃፊ"}, "as": {"download": "ডাউনলোড", "downloadWith": "Yood ৰ সৈতে ডাউনলোড", "watchLater": "পিছত চাওক", "saved": "✓ সংৰক্ষণ কৰা হ'ল", "savedTo": "পিছত চাবলৈ সংৰক্ষণ কৰা হ'ল", "removedFrom": "পিছত চোৱাৰ পৰা আঁতৰোৱা হ'ল", "alreadyIn": "ইতিমধ্যে পিছত চোৱাত আছে", "downloadAll": "সকলো ডাউনলোড কৰক", "clear": "মচক", "empty": "এতিয়াও কোনো ভিডিঅ' সংৰক্ষণ কৰা হোৱা নাই", "sent": "Yood লৈ পঠিওৱা হ'ল — পটভূমিত ডাউনলোড হৈ আছে", "cancel": "বাতিল কৰক", "playlistTitle": "গোটেই প্লেলিষ্ট ডাউনলোড কৰক", "playlistConfirm": "ইয়াৰ ফলত এই প্লেলিষ্টৰ আটাই {n}টা ভিডিঅ' ডাউনলোড হ'ব।", "browse": "ব্ৰাউজ কৰক…", "back": "পিছলৈ", "forward": "আগলৈ", "close": "বন্ধ কৰক", "browseFailed": "ফ'ল্ডাৰ বাছনি খুলিব পৰা নগ'ল", "saveToFolder": "ত সংৰক্ষণ কৰক", "defaultFolder": "ডিফ'ল্ট ফ'ল্ডাৰ"}, "be": {"download": "Спампаваць", "downloadWith": "Спампаваць з Yood", "watchLater": "Глядзець пазней", "saved": "✓ Захавана", "savedTo": "Захавана ў «Глядзець пазней»", "removedFrom": "Выдалена з «Глядзець пазней»", "alreadyIn": "Ужо ў «Глядзець пазней»", "downloadAll": "Спампаваць усё", "clear": "Ачысціць", "empty": "Пакуль нічога не захавана", "sent": "Адпраўлена ў Yood — загрузка ў фоне", "cancel": "Скасаваць", "playlistTitle": "Спампаваць увесь плэйліст", "playlistConfirm": "Будуць спампаваны ўсе {n} відэа з гэтага плэйліста.", "browse": "Агляд…", "back": "Назад", "forward": "Наперад", "close": "Закрыць", "browseFailed": "Не ўдалося адкрыць выбар папкі", "saveToFolder": "Захаваць у", "defaultFolder": "Папка па змаўчанні"}, "bn": {"download": "ডাউনলোড", "downloadWith": "Yood দিয়ে ডাউনলোড", "watchLater": "পরে দেখুন", "saved": "✓ সংরক্ষিত", "savedTo": "পরে দেখার জন্য সংরক্ষিত", "removedFrom": "পরে দেখা থেকে সরানো হয়েছে", "alreadyIn": "ইতিমধ্যে পরে দেখায় আছে", "downloadAll": "সব ডাউনলোড করুন", "clear": "মুছুন", "empty": "এখনও কোনো ভিডিও সংরক্ষণ করা হয়নি", "sent": "Yood-এ পাঠানো হয়েছে — ব্যাকগ্রাউন্ডে ডাউনলোড হচ্ছে", "cancel": "বাতিল", "playlistTitle": "সম্পূর্ণ প্লেলিস্ট ডাউনলোড করুন", "playlistConfirm": "এতে এই প্লেলিস্টের সব {n}টি ভিডিও ডাউনলোড হবে।", "browse": "ব্রাউজ করুন…", "back": "পেছনে", "forward": "সামনে", "close": "বন্ধ করুন", "browseFailed": "ফোল্ডার বাছাই খোলা যায়নি", "saveToFolder": "এতে সংরক্ষণ করুন", "defaultFolder": "ডিফল্ট ফোল্ডার"}, "bs": {"download": "Preuzmi", "downloadWith": "Preuzmi s Yood", "watchLater": "Pogledaj kasnije", "saved": "✓ Sačuvano", "savedTo": "Sačuvano u Pogledaj kasnije", "removedFrom": "Uklonjeno iz Pogledaj kasnije", "alreadyIn": "Već u Pogledaj kasnije", "downloadAll": "Preuzmi sve", "clear": "Očisti", "empty": "Još nema sačuvanih videozapisa", "sent": "Poslano u Yood — preuzima se u pozadini", "cancel": "Otkaži", "playlistTitle": "Preuzmi cijelu plejlistu", "playlistConfirm": "Time će se preuzeti svih {n} videozapisa sa plejliste.", "browse": "Pretraži…", "back": "Nazad", "forward": "Naprijed", "close": "Zatvori", "browseFailed": "Nije moguće otvoriti izbor mape", "saveToFolder": "Sačuvaj u", "defaultFolder": "Zadana mapa"}, "en-GB": {"download": "Download", "downloadWith": "Download with Yood", "watchLater": "Watch later", "saved": "✓ Saved", "savedTo": "Saved to Watch later", "removedFrom": "Removed from Watch later", "alreadyIn": "Already in Watch later", "downloadAll": "Download all", "clear": "Clear", "empty": "No videos saved yet", "sent": "Sent to Yood — downloading in the background", "cancel": "Cancel", "playlistTitle": "Download entire playlist", "playlistConfirm": "This will download all {n} videos in this playlist.", "browse": "Browse…", "back": "Back", "forward": "Forward", "close": "Close", "browseFailed": "Could not open folder picker", "saveToFolder": "Save to", "defaultFolder": "Default folder"}, "es-419": {"download": "Descargar", "downloadWith": "Descargar con Yood", "watchLater": "Ver más tarde", "saved": "✓ Guardado", "savedTo": "Guardado para ver más tarde", "removedFrom": "Eliminado de Ver más tarde", "alreadyIn": "Ya está en Ver más tarde", "downloadAll": "Descargar todo", "clear": "Borrar", "empty": "Aún no hay videos guardados", "sent": "Enviado a Yood — descargando en segundo plano", "cancel": "Cancelar", "playlistTitle": "Descargar la lista completa", "playlistConfirm": "Esto descargará los {n} videos de la lista.", "browse": "Examinar…", "back": "Atrás", "forward": "Adelante", "close": "Cerrar", "browseFailed": "No se pudo abrir el selector de carpetas", "saveToFolder": "Guardar en", "defaultFolder": "Carpeta predeterminada"}, "eu": {"download": "Deskargatu", "downloadWith": "Deskargatu Yood-ekin", "watchLater": "Geroago ikusi", "saved": "✓ Gordeta", "savedTo": "Geroago ikusteko gordea", "removedFrom": "Geroago ikusitik kenduta", "alreadyIn": "Jadanik Geroago ikusin", "downloadAll": "Dena deskargatu", "clear": "Garbitu", "empty": "Oraindik ez da bideorik gorde", "sent": "Yood-era bidalita — atzealdean deskargatzen", "cancel": "Utzi", "playlistTitle": "Playlist osoa deskargatu", "playlistConfirm": "Horrek playlisteko {n} bideo guztiak deskargatuko ditu.", "browse": "Arakatu…", "back": "Atzera", "forward": "Aurrera", "close": "Itxi", "browseFailed": "Ezin izan da karpeta-hautatzailea ireki", "saveToFolder": "Gorde hemen", "defaultFolder": "Lehenetsitako karpeta"}, "fil": {"download": "I-download", "downloadWith": "I-download gamit ang Yood", "watchLater": "Panoorin mamaya", "saved": "✓ Na-save", "savedTo": "Na-save sa Panoorin mamaya", "removedFrom": "Inalis sa Panoorin mamaya", "alreadyIn": "Nasa Panoorin mamaya na", "downloadAll": "I-download lahat", "clear": "I-clear", "empty": "Wala pang naka-save na video", "sent": "Ipinadala sa Yood — nagda-download sa background", "cancel": "Kanselahin", "playlistTitle": "I-download ang buong playlist", "playlistConfirm": "Ida-download nito ang lahat ng {n} video sa playlist na ito.", "browse": "Mag-browse…", "back": "Bumalik", "forward": "Magpatuloy", "close": "Isara", "browseFailed": "Hindi mabuksan ang tagapili ng folder", "saveToFolder": "I-save sa", "defaultFolder": "Default na folder"}, "fr-CA": {"download": "Télécharger", "downloadWith": "Télécharger avec Yood", "watchLater": "À regarder plus tard", "saved": "✓ Enregistré", "savedTo": "Enregistré à regarder plus tard", "removedFrom": "Retiré de À regarder plus tard", "alreadyIn": "Déjà dans À regarder plus tard", "downloadAll": "Tout télécharger", "clear": "Effacer", "empty": "Aucune vidéo enregistrée", "sent": "Envoyé à Yood — téléchargement en arrière-plan", "cancel": "Annuler", "playlistTitle": "Télécharger toute la playlist", "playlistConfirm": "Cela téléchargera les {n} vidéos de la playlist.", "browse": "Parcourir…", "back": "Retour", "forward": "Suivant", "close": "Fermer", "browseFailed": "Impossible d'ouvrir le sélecteur de dossier", "saveToFolder": "Enregistrer dans", "defaultFolder": "Dossier par défaut"}, "ga": {"download": "Íoslódáil", "downloadWith": "Íoslódáil le Yood", "watchLater": "Féach ar ball", "saved": "✓ Sábháilte", "savedTo": "Sábháilte le féachaint ar ball", "removedFrom": "Bainithe ó Féach ar ball", "alreadyIn": "I bhFéach ar ball cheana", "downloadAll": "Íoslódáil uile", "clear": "Glan", "empty": "Níl aon fhíseán sábháilte fós", "sent": "Seolta chuig Yood — á íoslódáil sa chúlra", "cancel": "Cealaigh", "playlistTitle": "Íoslódáil an seinmliosta iomlán", "playlistConfirm": "Íoslódálfar gach ceann de na {n} físeán sa seinmliosta seo.", "browse": "Brabhsáil…", "back": "Ar ais", "forward": "Ar aghaidh", "close": "Dún", "browseFailed": "Níorbh fhéidir roghnóir fillteán a oscailt", "saveToFolder": "Sábháil in", "defaultFolder": "Fillteán réamhshocraithe"}, "gl": {"download": "Descargar", "downloadWith": "Descargar con Yood", "watchLater": "Ver máis tarde", "saved": "✓ Gardado", "savedTo": "Gardado para ver máis tarde", "removedFrom": "Eliminado de Ver máis tarde", "alreadyIn": "Xa está en Ver máis tarde", "downloadAll": "Descargar todo", "clear": "Borrar", "empty": "Aínda non hai vídeos gardados", "sent": "Enviado a Yood — descargando en segundo plano", "cancel": "Cancelar", "playlistTitle": "Descargar a lista completa", "playlistConfirm": "Isto descargará os {n} vídeos da lista.", "browse": "Examinar…", "back": "Atrás", "forward": "Adiante", "close": "Pechar", "browseFailed": "Non se puido abrir o selector de cartafoles", "saveToFolder": "Gardar en", "defaultFolder": "Cartafol predeterminado"}, "gu": {"download": "ડાઉનલોડ", "downloadWith": "Yood સાથે ડાઉનલોડ", "watchLater": "પછીથી જુઓ", "saved": "✓ સાચવેલ", "savedTo": "પછીથી જોવા માટે સાચવેલ", "removedFrom": "પછીથી જુઓમાંથી દૂર કરેલ", "alreadyIn": "પહેલેથી પછીથી જુઓમાં છે", "downloadAll": "બધું ડાઉનલોડ કરો", "clear": "સાફ કરો", "empty": "હજુ કોઈ વિડિઓ સાચવેલ નથી", "sent": "Yood પર મોકલેલ — બેકગ્રાઉન્ડમાં ડાઉનલોડ થઈ રહ્યું છે", "cancel": "રદ કરો", "playlistTitle": "આખી પ્લેલિસ્ટ ડાઉનલોડ કરો", "playlistConfirm": "આનાથી આ પ્લેલિસ્ટના તમામ {n} વિડિઓ ડાઉનલોડ થશે.", "browse": "બ્રાઉઝ કરો…", "back": "પાછળ", "forward": "આગળ", "close": "બંધ કરો", "browseFailed": "ફોલ્ડર પસંદગી ખોલી શકાઈ નથી", "saveToFolder": "માં સાચવો", "defaultFolder": "ડિફોલ્ટ ફોલ્ડર"}, "hy": {"download": "Ներբեռնել", "downloadWith": "Ներբեռնել Yood-ով", "watchLater": "Դիտել ավելի ուշ", "saved": "✓ Պահպանված է", "savedTo": "Պահպանված է «Դիտել ավելի ուշ»-ում", "removedFrom": "Հեռացված է «Դիտել ավելի ուշ»-ից", "alreadyIn": "Արդեն «Դիտել ավելի ուշ»-ում է", "downloadAll": "Ներբեռնել բոլորը", "clear": "Մաքրել", "empty": "Դեռ ոչ մի տեսանյութ պահպանված չէ", "sent": "Ուղարկվել է Yood — ներբեռնումը ֆոնին", "cancel": "Չեղարկել", "playlistTitle": "Ներբեռնել ամբողջ ցուցակը", "playlistConfirm": "Սա կներբեռնի ցուցակի բոլոր {n} տեսանյութերը։", "browse": "Դիտել…", "back": "Հետ", "forward": "Առաջ", "close": "Փակել", "browseFailed": "Թղթապանակի ընտրությունը բացել չհաջողվեց", "saveToFolder": "Պահպանել այստեղ", "defaultFolder": "Լռելյայն թղթապանակ"}, "is": {"download": "Sækja", "downloadWith": "Sækja með Yood", "watchLater": "Horfa síðar", "saved": "✓ Vistað", "savedTo": "Vistað til að horfa síðar", "removedFrom": "Fjarlægt úr Horfa síðar", "alreadyIn": "Þegar í Horfa síðar", "downloadAll": "Sækja allt", "clear": "Hreinsa", "empty": "Engin myndbönd vistuð enn", "sent": "Sent til Yood — sækir í bakgrunni", "cancel": "Hætta við", "playlistTitle": "Sækja allan spilunarlistann", "playlistConfirm": "Þetta mun sækja öll {n} myndbönd á listanum.", "browse": "Veldu möppu…", "back": "Til baka", "forward": "Áfram", "close": "Loka", "browseFailed": "Gat ekki opnað möppuval", "saveToFolder": "Vista í", "defaultFolder": "Sjálfgefin mappa"}, "ka": {"download": "ჩამოტვირთვა", "downloadWith": "ჩამოტვირთვა Yood-ით", "watchLater": "ნახვა მოგვიანებით", "saved": "✓ შენახულია", "savedTo": "შენახულია სანახავად მოგვიანებით", "removedFrom": "წაშლილია სიიდან", "alreadyIn": "უკვე არის სიაში", "downloadAll": "ყველას ჩამოტვირთვა", "clear": "გასუფთავება", "empty": "ჯერ არცერთი ვიდეო არ არის შენახული", "sent": "გაგზავნილია Yood-ში — ჩამოტვირთვა ფონზე", "cancel": "გაუქმება", "playlistTitle": "მთლიანი დასაკრავი სიის ჩამოტვირთვა", "playlistConfirm": "ეს ჩამოტვირთავს ამ სიის ყველა {n} ვიდეოს.", "browse": "არჩევა…", "back": "უკან", "forward": "წინ", "close": "დახურვა", "browseFailed": "საქაღალდის არჩევა ვერ მოხერხდა", "saveToFolder": "შენახვა", "defaultFolder": "ნაგულისხმევი საქაღალდე"}, "km": {"download": "ទាញយក", "downloadWith": "ទាញយកជាមួយ Yood", "watchLater": "មើលពេលក្រោយ", "saved": "✓ បានរក្សាទុក", "savedTo": "បានរក្សាទុកដើម្បីមើលពេលក្រោយ", "removedFrom": "បានលុបចេញពីមើលពេលក្រោយ", "alreadyIn": "មាននៅក្នុងមើលពេលក្រោយរួចហើយ", "downloadAll": "ទាញយកទាំងអស់", "clear": "សម្អាត", "empty": "មិនទាន់មានវីដេអូដែលបានរក្សាទុក", "sent": "បានផ្ញើទៅ Yood — កំពុងទាញយកក្នុងផ្ទៃខាងក្រោយ", "cancel": "បោះបង់", "playlistTitle": "ទាញយកបញ្ជីទាំងមូល", "playlistConfirm": "នេះនឹងទាញយកវីដេអូទាំង {n} នៅក្នុងបញ្ជីនេះ។", "browse": "រកមើល…", "back": "ត្រឡប់", "forward": "ទៅមុខ", "close": "បិទ", "browseFailed": "មិនអាចបើកកម្មវិធីជ្រើសរើសថតបានទេ", "saveToFolder": "រក្សាទុកក្នុង", "defaultFolder": "ថតលំនាំដើម"}, "kn": {"download": "ಡೌನ್‌ಲೋಡ್", "downloadWith": "Yood ಜೊತೆ ಡೌನ್‌ಲೋಡ್", "watchLater": "ನಂತರ ನೋಡಿ", "saved": "✓ ಉಳಿಸಲಾಗಿದೆ", "savedTo": "ನಂತರ ನೋಡಲು ಉಳಿಸಲಾಗಿದೆ", "removedFrom": "ನಂತರ ನೋಡುವುದರಿಂದ ತೆಗೆದುಹಾಕಲಾಗಿದೆ", "alreadyIn": "ಈಗಾಗಲೇ ನಂತರ ನೋಡುವುದರಲ್ಲಿದೆ", "downloadAll": "ಎಲ್ಲವನ್ನೂ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", "clear": "ತೆರವುಗೊಳಿಸಿ", "empty": "ಇನ್ನೂ ಯಾವುದೇ ವೀಡಿಯೊ ಉಳಿಸಲಾಗಿಲ್ಲ", "sent": "Yood ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ — ಹಿನ್ನೆಲೆಯಲ್ಲಿ ಡೌನ್‌ಲೋಡ್ ಆಗುತ್ತಿದೆ", "cancel": "ರದ್ದುಮಾಡಿ", "playlistTitle": "ಸಂಪೂರ್ಣ ಪ್ಲೇಲಿಸ್ಟ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ", "playlistConfirm": "ಇದು ಈ ಪ್ಲೇಲಿಸ್ಟ್‌ನ ಎಲ್ಲಾ {n} ವೀಡಿಯೊಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡುತ್ತದೆ.", "browse": "ಬ್ರೌಸ್ ಮಾಡಿ…", "back": "ಹಿಂದೆ", "forward": "ಮುಂದೆ", "close": "ಮುಚ್ಚಿ", "browseFailed": "ಫೋಲ್ಡರ್ ಆಯ್ಕೆ ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ", "saveToFolder": "ಉಳಿಸಿ", "defaultFolder": "ಡೀಫಾಲ್ಟ್ ಫೋಲ್ಡರ್"}, "ky": {"download": "Жүктөп алуу", "downloadWith": "Yood менен жүктөп алуу", "watchLater": "Кийинчерээк көрүү", "saved": "✓ Сакталды", "savedTo": "Кийинчерээк көрүүгө сакталды", "removedFrom": "Кийинчерээк көрүүдөн өчүрүлдү", "alreadyIn": "Кийинчерээк көрүүдө бар", "downloadAll": "Баарын жүктөп алуу", "clear": "Тазалоо", "empty": "Азырынча сакталган видео жок", "sent": "Yood'ко жөнөтүлдү — фондо жүктөлүүдө", "cancel": "Жокко чыгаруу", "playlistTitle": "Бүт плейлистта жүктөп алуу", "playlistConfirm": "Бул плейлисттеги {n} видеонун баарын жүктөйт.", "browse": "Карап чыгуу…", "back": "Артка", "forward": "Алдыга", "close": "Жабуу", "browseFailed": "Папка тандагычты ачуу мүмкүн болбоду", "saveToFolder": "Сактоо", "defaultFolder": "Демейки папка"}, "lo": {"download": "ດາວໂຫລດ", "downloadWith": "ດາວໂຫລດດ້ວຍ Yood", "watchLater": "ເບິ່ງພາຍຫລັງ", "saved": "✓ ບັນທຶກແລ້ວ", "savedTo": "ບັນທຶກໄວ້ເບິ່ງພາຍຫລັງ", "removedFrom": "ລຶບອອກຈາກເບິ່ງພາຍຫລັງ", "alreadyIn": "ມີຢູ່ໃນເບິ່ງພາຍຫລັງແລ້ວ", "downloadAll": "ດາວໂຫລດທັງໝົດ", "clear": "ລຶບລ້າງ", "empty": "ຍັງບໍ່ມີວິດີໂອທີ່ບັນທຶກ", "sent": "ສົ່ງໄປ Yood ແລ້ວ — ກຳລັງດາວໂຫລດຢູ່ເບື້ອງຫລັງ", "cancel": "ຍົກເລີກ", "playlistTitle": "ດາວໂຫລດເພລยໝລິດທັງໝົດ", "playlistConfirm": "ນີ້ຈະດາວໂຫລດວິດີໂອທັງ {n} ອັນໃນເພລยໝລີນນີ້.", "browse": "ເລືອກເບິ່ງ…", "back": "ກັບຄືນ", "forward": "ໄປໜ້າ", "close": "ປິດ", "browseFailed": "ບໍ່ສາມາດເປີດຕົວເລືອກໂຟນເດີໄດ້", "saveToFolder": "ບັນທຶກລົງ", "defaultFolder": "ໂຟນເດີຄ່າເລີ່ມຕົ້ນ"}, "mk": {"download": "Преземи", "downloadWith": "Преземи со Yood", "watchLater": "Гледај подоцна", "saved": "✓ Зачувано", "savedTo": "Зачувано во Гледај подоцна", "removedFrom": "Отстрането од Гледај подоцна", "alreadyIn": "Веќе во Гледај подоцна", "downloadAll": "Преземи сè", "clear": "Исчисти", "empty": "Сè уште нема зачувани видеа", "sent": "Испратено до Yood — се презема во позадина", "cancel": "Откажи", "playlistTitle": "Преземи ја целата плејлиста", "playlistConfirm": "Ова ќе ги преземе сите {n} видеа од плејлистата.", "browse": "Пребарај…", "back": "Назад", "forward": "Напред", "close": "Затвори", "browseFailed": "Не може да се отвори изборот на папка", "saveToFolder": "Зачувај во", "defaultFolder": "Стандардна папка"}, "ml": {"download": "ഡൗൺലോഡ്", "downloadWith": "Yood ഉപയോഗിച്ച് ഡൗൺലോഡ്", "watchLater": "പിന്നീട് കാണുക", "saved": "✓ സംരക്ഷിച്ചു", "savedTo": "പിന്നീട് കാണാൻ സംരക്ഷിച്ചു", "removedFrom": "പിന്നീട് കാണുകയിൽ നിന്ന് നീക്കംചെയ്തു", "alreadyIn": "ഇതിനകം പിന്നീട് കാണുകയിൽ ഉണ്ട്", "downloadAll": "എല്ലാം ഡൗൺലോഡ് ചെയ്യുക", "clear": "മായ്ക്കുക", "empty": "ഇതുവരെ വീഡിയോകളൊന്നും സംരക്ഷിച്ചിട്ടില്ല", "sent": "Yood-ലേക്ക് അയച്ചു — പശ്ചാത്തലത്തിൽ ഡൗൺലോഡ് ചെയ്യുന്നു", "cancel": "റദ്ദാക്കുക", "playlistTitle": "മുഴുവൻ പ്ലേലിസ്റ്റും ഡൗൺലോഡ് ചെയ്യുക", "playlistConfirm": "ഇത് ഈ പ്ലേലിസ്റ്റിലെ എല്ലാ {n} വീഡിയോകളും ഡൗൺലോഡ് ചെയ്യും.", "browse": "ബ്രൗസ് ചെയ്യുക…", "back": "പിന്നോട്ട്", "forward": "മുന്നോട്ട്", "close": "അടയ്ക്കുക", "browseFailed": "ഫോൾഡർ തിരഞ്ഞെടുക്കൽ തുറക്കാനായില്ല", "saveToFolder": "സംരക്ഷിക്കുക", "defaultFolder": "സ്ഥിര ഫോൾഡർ"}, "mn": {"download": "Татаж авах", "downloadWith": "Yood-оор татаж авах", "watchLater": "Дараа үзэх", "saved": "✓ Хадгалагдлаа", "savedTo": "Дараа үзэхэд хадгалагдлаа", "removedFrom": "Дараа үзэхээс хасагдлаа", "alreadyIn": "Дараа үзэхэд аль хэдийн байна", "downloadAll": "Бүгдийг татаж авах", "clear": "Цэвэрлэх", "empty": "Одоогоор хадгалсан видео алга", "sent": "Yood руу илгээгдлээ — ар талд татагдаж байна", "cancel": "Цуцлах", "playlistTitle": "Бүтэн тоглуулах жагсаалтыг татах", "playlistConfirm": "Энэ нь жагсаалтын {n} видеог бүгдийг татна.", "browse": "Үзэх…", "back": "Буцах", "forward": "Урагшлах", "close": "Хаах", "browseFailed": "Хавтас сонгогчийг нээж чадсангүй", "saveToFolder": "Хадгалах", "defaultFolder": "Үндсэн хавтас"}, "mr": {"download": "डाउनलोड", "downloadWith": "Yood सह डाउनलोड", "watchLater": "नंतर पहा", "saved": "✓ जतन केले", "savedTo": "नंतर पाहण्यासाठी जतन केले", "removedFrom": "नंतर पहामधून काढले", "alreadyIn": "आधीच नंतर पहामध्ये आहे", "downloadAll": "सर्व डाउनलोड करा", "clear": "साफ करा", "empty": "अद्याप कोणताही व्हिडिओ जतन केलेला नाही", "sent": "Yood ला पाठवले — बॅकग्राउंडमध्ये डाउनलोड होत आहे", "cancel": "रद्द करा", "playlistTitle": "संपूर्ण प्लेलिस्ट डाउनलोड करा", "playlistConfirm": "यामुळे या प्लेलिस्टमधील सर्व {n} व्हिडिओ डाउनलोड होतील.", "browse": "ब्राउझ करा…", "back": "मागे", "forward": "पुढे", "close": "बंद करा", "browseFailed": "फोल्डर निवड उघडता आली नाही", "saveToFolder": "येथे जतन करा", "defaultFolder": "डीफॉल्ट फोल्डर"}, "mt": {"download": "Niżżel", "downloadWith": "Niżżel b'Yood", "watchLater": "Ara aktar tard", "saved": "✓ Iffrankat", "savedTo": "Iffrankat biex tara aktar tard", "removedFrom": "Imneħħi minn Ara aktar tard", "alreadyIn": "Diġà f'Ara aktar tard", "downloadAll": "Niżżel kollox", "clear": "Naddaf", "empty": "Għad m'hemmx videos iffrankati", "sent": "Mibgħut lil Yood — qed jinniżżel fl-isfond", "cancel": "Ikkanċella", "playlistTitle": "Niżżel il-playlist kollha", "playlistConfirm": "Dan se jniżżel il-{n} videos kollha f'din il-playlist.", "browse": "Ibbrawżja…", "back": "Lura", "forward": "Quddiem", "close": "Agħlaq", "browseFailed": "Ma stajtx tiftaħ l-għażla tal-folder", "saveToFolder": "Iffranka f'", "defaultFolder": "Folder prestabbilit"}, "my": {"download": "ဒေါင်းလုဒ်", "downloadWith": "Yood ဖြင့် ဒေါင်းလုဒ်", "watchLater": "နောက်မှ ကြည့်ရန်", "saved": "✓ သိမ်းဆည်းပြီး", "savedTo": "နောက်မှကြည့်ရန်သိမ်းဆည်းပြီး", "removedFrom": "နောက်မှကြည့်ရန်မှဖယ်ရှားပြီး", "alreadyIn": "နောက်မှကြည့်ရန်တွင်ရှိနှင့်ပြီး", "downloadAll": "အားလုံးဒေါင်းလုဒ်", "clear": "ရှင်းလင်းရန်", "empty": "သိမ်းဆည်းထားသောဗီဒီယိုမရှိသေး", "sent": "Yood သို့ပို့ပြီး — နောက်ကွယ်တွင်ဒေါင်းလုဒ်ဆွဲနေသည်", "cancel": "ပယ်ဖျက်ရန်", "playlistTitle": "ပလေးလစ်တစ်ခုလုံးဒေါင်းလုဒ်", "playlistConfirm": "ဤပလေးလစ်ရှိဗီဒီယို {n} ခုလုံးဒေါင်းလုဒ်ဆွဲမည်။", "browse": "ရှာဖွေ…", "back": "နောက်သို့", "forward": "ရှေ့သို့", "close": "ပိတ်ရန်", "browseFailed": "ဖိုဒါရွေးချယ်မှုဖွင့်၍မရပါ", "saveToFolder": "သိမ်းဆည်းရန်", "defaultFolder": "မူရင်းဖိုဒါ"}, "ne": {"download": "डाउनलोड", "downloadWith": "Yood सँग डाउनलोड", "watchLater": "पछि हेर्नुहोस्", "saved": "✓ सेभ गरियो", "savedTo": "पछि हेर्नका लागि सेभ गरियो", "removedFrom": "पछि हेर्नेबाट हटाइयो", "alreadyIn": "पहिलेदेखि नै पछि हेर्नेमा छ", "downloadAll": "सबै डाउनलोड गर्नुहोस्", "clear": "खाली गर्नुहोस्", "empty": "अहिलेसम्म कुनै भिडियो सेभ गरिएको छैन", "sent": "Yood मा पठाइयो — पृष्ठभूमिमा डाउनलोड हुँदैछ", "cancel": "रद्द गर्नुहोस्", "playlistTitle": "सम्पूर्ण प्लेलिस्ट डाउनलोड गर्नुहोस्", "playlistConfirm": "यसले यस प्लेलिस्टका सबै {n} भिडियो डाउनलोड गर्नेछ।", "browse": "ब्राउज गर्नुहोस्…", "back": "पछाडि", "forward": "अगाडि", "close": "बन्द गर्नुहोस्", "browseFailed": "फोल्डर छनोट खोल्न सकिएन", "saveToFolder": "सेभ गर्नुहोस्", "defaultFolder": "डिफल्ट फोल्डर"}, "or": {"download": "ଡାଉନଲୋଡ୍", "downloadWith": "Yood ସହିତ ଡାଉନଲୋଡ୍", "watchLater": "ପରେ ଦେଖନ୍ତୁ", "saved": "✓ ସଞ୍ଚୟ ହେଲା", "savedTo": "ପରେ ଦେଖିବା ପାଇଁ ସଞ୍ଚୟ ହେଲା", "removedFrom": "ପରେ ଦେଖନ୍ତୁରୁ ହଟାଗଲା", "alreadyIn": "ପୂର୍ବରୁ ପରେ ଦେଖନ୍ତୁରେ ଅଛି", "downloadAll": "ସବୁ ଡାଉନଲୋଡ୍ କରନ୍ତୁ", "clear": "ସଫା କରନ୍ତୁ", "empty": "ବର୍ତ୍ତମାନ ସୁଦ୍ଧା କୌଣସି ଭିଡିଓ ସଞ୍ଚୟ ହୋଇନାହିଁ", "sent": "Yood କୁ ପଠାଗଲା — ପୃଷ୍ଠଭୂମିରେ ଡାଉନଲୋଡ୍ ହେଉଛି", "cancel": "ବାତିଲ କରନ୍ତୁ", "playlistTitle": "ସମ୍ପୂର୍ଣ୍ଣ ପ୍ଲେଲିଷ୍ଟ ଡାଉନଲୋଡ୍ କରନ୍ତୁ", "playlistConfirm": "ଏହା ଏହି ପ୍ଲେଲିଷ୍ଟର ସମସ୍ତ {n} ଭିଡିଓ ଡାଉନଲୋଡ୍ କରିବ।", "browse": "ବ୍ରାଉଜ କରନ୍ତୁ…", "back": "ପଛକୁ", "forward": "ଆଗକୁ", "close": "ବନ୍ଦ କରନ୍ତୁ", "browseFailed": "ଫୋଲ୍ଡର ବାଛିବା ଖୋଲିପାରିଲା ନାହିଁ", "saveToFolder": "ସଞ୍ଚୟ କରନ୍ତୁ", "defaultFolder": "ଡିଫଲ୍ଟ ଫୋଲ୍ଡର"}, "pa": {"download": "ਡਾਊਨਲੋਡ", "downloadWith": "Yood ਨਾਲ ਡਾਊਨਲੋਡ", "watchLater": "ਬਾਅਦ ਵਿੱਚ ਵੇਖੋ", "saved": "✓ ਸੰਭਾਲਿਆ", "savedTo": "ਬਾਅਦ ਵਿੱਚ ਵੇਖਣ ਲਈ ਸੰਭਾਲਿਆ", "removedFrom": "ਬਾਅਦ ਵਿੱਚ ਵੇਖੋ ਵਿੱਚੋਂ ਹਟਾਇਆ", "alreadyIn": "ਪਹਿਲਾਂ ਤੋਂ ਬਾਅਦ ਵਿੱਚ ਵੇਖੋ ਵਿੱਚ ਹੈ", "downloadAll": "ਸਭ ਡਾਊਨਲੋਡ ਕਰੋ", "clear": "ਸਾਫ਼ ਕਰੋ", "empty": "ਅਜੇ ਤੱਕ ਕੋਈ ਵੀਡੀਓ ਸੰਭਾਲਿਆ ਨਹੀਂ", "sent": "Yood ਨੂੰ ਭੇਜਿਆ — ਬੈਕਗ੍ਰਾਊਂਡ ਵਿੱਚ ਡਾਊਨਲੋਡ ਹੋ ਰਿਹਾ ਹੈ", "cancel": "ਰੱਦ ਕਰੋ", "playlistTitle": "ਪੂਰੀ ਪਲੇਲਿਸਟ ਡਾਊਨਲੋਡ ਕਰੋ", "playlistConfirm": "ਇਸ ਨਾਲ ਇਸ ਪਲੇਲਿਸਟ ਦੇ ਸਾਰੇ {n} ਵੀਡੀਓ ਡਾਊਨਲੋਡ ਹੋਣਗੇ।", "browse": "ਬ੍ਰਾਊਜ਼ ਕਰੋ…", "back": "ਪਿੱਛੇ", "forward": "ਅੱਗੇ", "close": "ਬੰਦ ਕਰੋ", "browseFailed": "ਫੋਲਡਰ ਚੋਣ ਖੋਲ੍ਹੀ ਨਹੀਂ ਜਾ ਸਕੀ", "saveToFolder": "ਸੰਭਾਲੋ", "defaultFolder": "ਡਿਫਾਲਟ ਫੋਲਡਰ"}, "pt-PT": {"download": "Transferir", "downloadWith": "Transferir com Yood", "watchLater": "Ver mais tarde", "saved": "✓ Guardado", "savedTo": "Guardado em Ver mais tarde", "removedFrom": "Removido de Ver mais tarde", "alreadyIn": "Já está em Ver mais tarde", "downloadAll": "Transferir tudo", "clear": "Limpar", "empty": "Ainda não há vídeos guardados", "sent": "Enviado para o Yood — a transferir em segundo plano", "cancel": "Cancelar", "playlistTitle": "Transferir a playlist inteira", "playlistConfirm": "Isto vai transferir todos os {n} vídeos desta playlist.", "browse": "Procurar…", "back": "Anterior", "forward": "Seguinte", "close": "Fechar", "browseFailed": "Não foi possível abrir o seletor de pastas", "saveToFolder": "Guardar em", "defaultFolder": "Pasta predefinida"}, "si": {"download": "බාගන්න", "downloadWith": "Yood සමඟ බාගන්න", "watchLater": "පසුව බලන්න", "saved": "✓ සුරකින ලදී", "savedTo": "පසුව බැලීමට සුරකින ලදී", "removedFrom": "පසුව බලන්නෙන් ඉවත් කරන ලදී", "alreadyIn": "දැනටමත් පසුව බලන්නෙහි ඇත", "downloadAll": "සියල්ල බාගන්න", "clear": "හිස් කරන්න", "empty": "සුරකින ලද වීඩියෝ නැත", "sent": "Yood වෙත යවන ලදී — පසුබිමේ බාගත වෙමින්", "cancel": "අවලංගු කරන්න", "playlistTitle": "මුළු ධාවන ලැයිස්තුවම බාගන්න", "playlistConfirm": "මෙය මෙම ලැයිස්තුවේ ඇති {n} වීඩියෝ සියල්ල බාගනු ඇත.", "browse": "පිරික්සන්න…", "back": "ආපසු", "forward": "ඉදිරියට", "close": "වසන්න", "browseFailed": "ෆෝල්ඩර තේරීම විවෘත කළ නොහැකි විය", "saveToFolder": "සුරකින්න", "defaultFolder": "පෙරනිමි ෆෝල්ඩරය"}, "sq": {"download": "Shkarko", "downloadWith": "Shkarko me Yood", "watchLater": "Shiko më vonë", "saved": "✓ Ruajtur", "savedTo": "Ruajtur te Shiko më vonë", "removedFrom": "Hequr nga Shiko më vonë", "alreadyIn": "Tashmë te Shiko më vonë", "downloadAll": "Shkarko të gjitha", "clear": "Pastro", "empty": "Ende asnjë video e ruajtur", "sent": "Dërguar te Yood — po shkarkohet në sfond", "cancel": "Anulo", "playlistTitle": "Shkarko gjithë playlistën", "playlistConfirm": "Kjo do të shkarkojë të {n} videot e kësaj playliste.", "browse": "Shfleto…", "back": "Prapa", "forward": "Para", "close": "Mbyll", "browseFailed": "S'u hap dot zgjedhësi i dosjeve", "saveToFolder": "Ruaj te", "defaultFolder": "Dosja e paracaktuar"}, "sw": {"download": "Pakua", "downloadWith": "Pakua ukitumia Yood", "watchLater": "Tazama baadaye", "saved": "✓ Imehifadhiwa", "savedTo": "Imehifadhiwa katika Tazama baadaye", "removedFrom": "Imeondolewa kutoka Tazama baadaye", "alreadyIn": "Tayari iko katika Tazama baadaye", "downloadAll": "Pakua zote", "clear": "Futa", "empty": "Bado hakuna video zilizohifadhiwa", "sent": "Imetumwa kwa Yood — inapukua chinichini", "cancel": "Ghairi", "playlistTitle": "Pakua orodha yote", "playlistConfirm": "Hii itapakua video zote {n} katika orodha hii.", "browse": "Vinjari…", "back": "Nyuma", "forward": "Mbele", "close": "Funga", "browseFailed": "Imeshindwa kufungua kichaguzi cha folda", "saveToFolder": "Hifadhi katika", "defaultFolder": "Folda chaguo-msingi"}, "ta": {"download": "பதிவிறக்கு", "downloadWith": "Yood உடன் பதிவிறக்கு", "watchLater": "பின்னர் பார்", "saved": "✓ சேமிக்கப்பட்டது", "savedTo": "பின்னர் பார்க்க சேமிக்கப்பட்டது", "removedFrom": "பின்னர் பார் என்பதிலிருந்து நீக்கப்பட்டது", "alreadyIn": "ஏற்கனவே பின்னர் பாரில் உள்ளது", "downloadAll": "அனைத்தையும் பதிவிறக்கு", "clear": "அழி", "empty": "இன்னும் வீடியோக்கள் சேமிக்கப்படவில்லை", "sent": "Yood க்கு அனுப்பப்பட்டது — பின்னணியில் பதிவிறக்கப்படுகிறது", "cancel": "ரத்து", "playlistTitle": "முழு பிளேலிஸ்டையும் பதிவிறக்கு", "playlistConfirm": "இது இந்த பிளேலிஸ்டில் உள்ள அனைத்து {n} வீடியோக்களையும் பதிவிறக்கும்.", "browse": "உலாவு…", "back": "பின்", "forward": "முன்", "close": "மூடு", "browseFailed": "கோப்புறை தேர்வியைத் திறக்க முடியவில்லை", "saveToFolder": "சேமி", "defaultFolder": "இயல்புநிலை கோப்புறை"}, "te": {"download": "డౌన్‌లోడ్", "downloadWith": "Yood తో డౌన్‌లోడ్", "watchLater": "తర్వాత చూడండి", "saved": "✓ సేవ్ చేయబడింది", "savedTo": "తర్వాత చూడటానికి సేవ్ చేయబడింది", "removedFrom": "తర్వాత చూడండి నుండి తొలగించబడింది", "alreadyIn": "ఇప్పటికే తర్వాత చూడండిలో ఉంది", "downloadAll": "అన్నీ డౌన్‌లోడ్ చేయండి", "clear": "క్లియర్ చేయండి", "empty": "ఇంకా వీడియోలేవీ సేవ్ చేయబడలేదు", "sent": "Yood కు పంపబడింది — నేపథ్యంలో డౌన్‌లోడ్ అవుతోంది", "cancel": "రద్దు చేయండి", "playlistTitle": "మొత్తం ప్లేలిస్ట్ డౌన్‌లోడ్ చేయండి", "playlistConfirm": "ఇది ఈ ప్లేలిస్ట్‌లోని అన్ని {n} వీడియోలను డౌన్‌లోడ్ చేస్తుంది.", "browse": "బ్రౌజ్ చేయండి…", "back": "వెనుకకు", "forward": "ముందుకు", "close": "మూసివేయండి", "browseFailed": "ఫోల్డర్ ఎంపిక తెరవడం సాధ్యపడలేదు", "saveToFolder": "సేవ్ చేయండి", "defaultFolder": "డిఫాల్ట్ ఫోల్డర్"}, "ur": {"download": "ڈاؤن لوڈ", "downloadWith": "Yood کے ساتھ ڈاؤن لوڈ", "watchLater": "بعد میں دیکھیں", "saved": "✓ محفوظ ہو گیا", "savedTo": "بعد میں دیکھنے کے لیے محفوظ ہو گیا", "removedFrom": "بعد میں دیکھیں سے ہٹا دیا گیا", "alreadyIn": "پہلے سے بعد میں دیکھیں میں ہے", "downloadAll": "سب ڈاؤن لوڈ کریں", "clear": "صاف کریں", "empty": "ابھی تک کوئی ویڈیو محفوظ نہیں ہوئی", "sent": "Yood کو بھیجا گیا — پس منظر میں ڈاؤن لوڈ ہو رہا ہے", "cancel": "منسوخ کریں", "playlistTitle": "مکمل پلے لسٹ ڈاؤن لوڈ کریں", "playlistConfirm": "یہ اس پلے لسٹ کی تمام {n} ویڈیوز ڈاؤن لوڈ کرے گا۔", "browse": "براؤز کریں…", "back": "پیچھے", "forward": "آگے", "close": "بند کریں", "browseFailed": "فولڈر کا انتخاب نہیں کھولا جا سکا", "saveToFolder": "محفوظ کریں", "defaultFolder": "ڈیفالٹ فولڈر"}, "uz": {"download": "Yuklab olish", "downloadWith": "Yood bilan yuklab olish", "watchLater": "Keyinroq ko‘rish", "saved": "✓ Saqlandi", "savedTo": "Keyinroq ko‘rishga saqlandi", "removedFrom": "Keyinroq ko‘rishdan o‘chirildi", "alreadyIn": "Keyinroq ko‘rishda bor", "downloadAll": "Barchasini yuklab olish", "clear": "Tozalash", "empty": "Hozircha saqlangan videolar yo‘q", "sent": "Yood'ga yuborildi — fonda yuklanmoqda", "cancel": "Bekor qilish", "playlistTitle": "Butun pleylistni yuklab olish", "playlistConfirm": "Bu pleylistdagi {n} videoning barchasini yuklaydi.", "browse": "Ko‘rish…", "back": "Orqaga", "forward": "Oldinga", "close": "Yopish", "browseFailed": "Papka tanlagichni ochib bo‘lmadi", "saveToFolder": "Saqlash", "defaultFolder": "Birlamchi papka"}, "zu": {"download": "Landa", "downloadWith": "Landa nge-Yood", "watchLater": "Bukela kamuva", "saved": "✓ Kulondoloziwe", "savedTo": "Kulondoloziwe kokubuka kamuva", "removedFrom": "Kususiwe kokubuka kamuva", "alreadyIn": "Sesiku kokubuka kamuva", "downloadAll": "Landa konke", "clear": "Sula", "empty": "Awekho amavidiyo alondoloziwe okwamanje", "sent": "Kuthunyelwe ku-Yood — kulanda ngemuva", "cancel": "Khansela", "playlistTitle": "Landa uhlu lonke", "playlistConfirm": "Lokhu kuzolanda wonke amavidiyo angu-{n} kulolu hlu.", "browse": "Phequlula…", "back": "Emuva", "forward": "Phambili", "close": "Vala", "browseFailed": "Yehlulekile ukuvula isikhethi sefolda", "saveToFolder": "Londoloza ku", "defaultFolder": "Ifolda ezenzakalelayo"}};
  function yoodPageLang() {
    try {
      // 1) YouTube's own interface language (most reliable: this is what the
      //    Save/Share/menu strings on screen actually follow).
      try {
        if (window.ytcfg) {
          var hl = "";
          try { hl = window.ytcfg.get ? window.ytcfg.get("HL", "") : ""; } catch (e) { hl = ""; }
          if (!hl && window.ytcfg.data_) hl = window.ytcfg.data_.HL || "";
          if (hl && /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(hl)) return String(hl).toLowerCase().replace(/_/g, "-");
        }
      } catch (e) { }
      try {
        if (window.yt && window.yt.config_ && window.yt.config_.hl &&
          /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(window.yt.config_.hl)) {
          return String(window.yt.config_.hl).toLowerCase().replace(/_/g, "-");
        }
      } catch (e) { }
      // 2) PREF cookie hl=xx (YouTube persists the UI language here).
      try {
        var m = /(?:^|;\s*)PREF=([^;]*)/.exec(document.cookie || "");
        if (m) {
          var hm = /(?:^|&)hl=([^&]*)/.exec(decodeURIComponent(m[1]));
          if (hm && hm[1] && /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(hm[1])) {
            return String(hm[1]).toLowerCase().replace(/_/g, "-");
          }
        }
      } catch (e) { }
      // 3) Document language attributes.
      try {
        var l = (document.documentElement && document.documentElement.lang) || "";
        if (l && !/^en(-|$)/i.test(l)) return String(l).toLowerCase().replace(/_/g, "-");
        if (l) {
          try {
            var h = document.querySelector("html");
            var hl2 = (h && h.getAttribute("hl")) || "";
            if (hl2) return String(hl2).toLowerCase().replace(/_/g, "-");
          } catch (e2) { }
          return String(l).toLowerCase().replace(/_/g, "-");
        }
      } catch (e) { }
      try { var h2 = document.querySelector("html"); var hl3 = (h2 && h2.getAttribute("hl")) || ""; if (hl3) return String(hl3).toLowerCase().replace(/_/g, "-"); } catch (e) { }
      // 4) Browser language (last resort: this is the BROWSER's language,
      //    not necessarily YouTube's UI language).
      try { var nl = navigator.language || "en"; return String(nl).toLowerCase().replace(/_/g, "-"); } catch (e) { return "en"; }
    } catch (e) { return "en"; }
  }
  function yoodT(key) {
    try {
      var lang = yoodPageLang();
      var base = lang.split("-")[0];
      if (base === "iw") base = "he";
      if (base === "zh") {
        if (lang === "zh-tw" || lang === "zh-hk") return (YOOD_I18N["zh-tw"] && YOOD_I18N["zh-tw"][key]) || YOOD_I18N.en[key] || key;
        return (YOOD_I18N["zh-cn"] && YOOD_I18N["zh-cn"][key]) || YOOD_I18N.en[key] || key;
      }
      var table = YOOD_I18N[lang] || YOOD_I18N[base] || YOOD_I18N.en;
      if (table && table[key]) return table[key];
      if (YOOD_I18N.en && YOOD_I18N.en[key]) return YOOD_I18N.en[key];
      return key;
    } catch (e) { return key; }
  }
  // Flat multilingual word lists for Share/Save/overflow detection.
  // Positional fallback (Save is normally right before overflow) covers any
  // language missing here, so this list only improves precision.
  var YOOD_SAVE_WORDS = ["save", "saved", "\u05e9\u05de\u05d9\u05e8\u05d4", "\u05e9\u05de\u05d5\u05e8", "\u05e0\u05e9\u05de\u05e8", "\u062d\u0641\u0638", "guardar", "guardado", "enregistrer", "enregistr\u00e9", "speichern", "gespeichert", "\u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c", "\u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e", "salvar", "salvo", "salva", "salvato", "opslaan", "opgeslagen", "zapisz", "zapisano", "kaydet", "kaydedildi", "\u0938\u0939\u0947\u091c\u0947\u0902", "\u4fdd\u5b58", "\u5132\u5b58", "\u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438", "\u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e", "\u0630\u062e\u06cc\u0631\u0647", "simpan", "disimpan", "ulo\u017eit", "ulo\u017eeno", "salveaz", "salvat", "ment\u00e9s", "mentve", "\u03b1\u03c0\u03bf\u03b8\u03ae\u03ba\u03b5\u03c5\u03c3\u03b7", "spara", "sparad", "gem", "gemt", "tallenna", "tallennettu", "lagre", "lagret", "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01", "l\u01b0u", "\u00f1\u00e0\u00e0\u00e0"];
  var YOOD_SHARE_WORDS = ["share", "\u05e9\u05d9\u05ea\u05d5\u05e3", "\u05e9\u05ea\u05e3", "\u0645\u0634\u0627\u0631\u0643\u0629", "compartir", "partager", "teilen", "\u043f\u043e\u0434\u0435\u043b\u0438\u0442\u044c\u0441\u044f", "compartilhar", "partilhar", "condividi", "delen", "udost\u0119pnij", "payla\u015f", "\u0936\u0947\u092f\u0930", "\u5171\u6709", "\uacf5\uc720", "\u5206\u4eab", "\u043f\u043e\u0434\u0456\u043b\u0438\u0442\u0438\u0441\u044f", "\u0627\u0634\u062a\u0631\u0627\u06a9", "bagikan"];
  var YOOD_MORE_WORDS = ["more actions", "additional actions", "\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05e0\u05d5\u05e1\u05e4\u05d5\u05ea", "\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0625\u0636\u0627\u0641\u064a\u0629", "m\u00e1s acciones", "plus d\u0027actions", "weitere aktionen", "\u0434\u0440\u0443\u0433\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f", "mais a\u00e7\u00f5es", "altre azioni", "meer acties", "wi\u0119cej dzia\u0142a\u0144", "di\u011fer \u0131\u015flemler", "\u305d\u306e\u4ed6\u306e\u64cd\u4f5c", "\ucd94\uac00 \uc791\uc5c5", "\u66f4\u591a\u64cd\u4f5c", "\u0456\u043d\u0448\u0456 \u0434\u0456\u0457"];
  function yoodFindActionAnchor(host) {
    try {
      var kids = [];
      try { kids = Array.prototype.slice.call(host.children); } catch (e) { return null; }
      kids = kids.filter(function (k) { return k instanceof Element && !k.hasAttribute(MARK) && !k.hasAttribute(MARK_LATER) && !k.hasAttribute("data-yood-main"); });
      if (!kids.length) return null;
      var norm = function (s) { try { return String(s || "").trim().toLowerCase(); } catch (e) { return ""; } };
      var combined = function (el) { try { return norm((el.textContent || "") + " " + (el.getAttribute("aria-label") || "")); } catch (e) { return ""; } };
      var isOverflow = function (el) {
        try {
          var tag = ""; try { tag = el.tagName.toLowerCase(); } catch (e) { }
          if (tag === "ytd-menu-renderer") return true;
          var aria = ""; try { aria = norm(el.getAttribute("aria-label")); } catch (e) { }
          for (var i = 0; i < YOOD_MORE_WORDS.length; i++) { var w = YOOD_MORE_WORDS[i]; if (w && aria && aria.indexOf(w) !== -1) return true; }
          try { if (el.querySelector && el.querySelector("ytd-menu-renderer")) return true; } catch (e) { }
        } catch (e) { }
        return false;
      };
      var isSave = function (el) { var s = combined(el); if (!s) return false; for (var i = 0; i < YOOD_SAVE_WORDS.length; i++) { var w = YOOD_SAVE_WORDS[i]; if (w && s.indexOf(w) !== -1) return true; } return false; };
      var isShare = function (el) { var s = combined(el); if (!s) return false; for (var i = 0; i < YOOD_SHARE_WORDS.length; i++) { var w = YOOD_SHARE_WORDS[i]; if (w && s.indexOf(w) !== -1) return true; } return false; };
      var overflowIdx = -1, saveIdx = -1, shareIdx = -1;
      for (var k = 0; k < kids.length; k++) {
        if (overflowIdx === -1 && isOverflow(kids[k])) overflowIdx = k;
        if (saveIdx === -1 && isSave(kids[k])) saveIdx = k;
        if (shareIdx === -1 && isShare(kids[k])) shareIdx = k;
      }
      // A single wrapper matching BOTH is an outer container, not a button
      // (e.g. #actions-inner contains the whole row): ignore it so the
      // button never lands outside the Like/Share/Save row.
      if (saveIdx !== -1 && saveIdx === shareIdx) { saveIdx = -1; shareIdx = -1; }
      if (saveIdx !== -1 && shareIdx !== -1) {
        var later = saveIdx > shareIdx ? saveIdx : shareIdx;
        return kids[later] || null;
      }
      if (saveIdx !== -1) return kids[saveIdx] || null;
      if (shareIdx !== -1) return kids[shareIdx + 1] || null;
      if (overflowIdx !== -1) {
        if (overflowIdx >= 2) return kids[overflowIdx - 1] || kids[overflowIdx] || null;
        return kids[overflowIdx] || null;
      }
      return null;
    } catch (e) { return null; }
  }

  // ================= Ad blocking (Brave app mode) =================
  // Layer 1 (network) lives in rules.json (declarativeNetRequest).
  // The request and player-response layer runs in page.js (MAIN world);
  // content-script globals cannot intercept YouTube's own fetch/XHR.
  var AD_RENDERER_SELECTOR = [
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-display-ad-renderer",
    "ytd-banner-promo-renderer",
    "ytd-promoted-video-renderer",
    "ytd-compact-promoted-video-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-sparkles-text-search-renderer",
    "ytd-statement-banner-renderer",
    "ytd-companion-slot-renderer",
    "ytd-action-companion-ad-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-reel-player-overlay-renderer #reel-ad-badge",
    "#player-ads",
    "#masthead-ad",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    ".ytp-ad-player-overlay",
    ".ytp-ad-text",
    ".video-ads"
  ].join(",");
  var AD_CARD_SELECTOR = "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer";

  function yoodEnsureAdStyle() {
    try {
      if (document.getElementById("yood-ad-style")) return;
      var head = document.head || document.documentElement;
      if (!head) return;
      var style = document.createElement("style");
      style.id = "yood-ad-style";
      // One rule per selector: if YouTube's engine rejects one modern
      // selector it discards only that rule, not the whole sheet.
      var parts = AD_RENDERER_SELECTOR.split(",");
      var css = "";
      for (var i = 0; i < parts.length; i++) {
        var sel = parts[i].replace(/^\s+|\s+$/g, "");
        if (sel) css += sel + " { display: none !important; }\n";
      }
      style.textContent = css;
      (document.head || head).appendChild(style);
    } catch (e) { /* never break the page */ }
  }

  function yoodRemoveKnownAds(root) {
    var removed = false;
    try {
      var scope = root || document;
      var renderers = [];
      if (scope instanceof Element && scope.matches && scope.matches(AD_RENDERER_SELECTOR)) {
        renderers.push(scope);
      }
      var found = scope.querySelectorAll ? scope.querySelectorAll(AD_RENDERER_SELECTOR) : [];
      for (var i = 0; i < found.length; i++) renderers.push(found[i]);
      for (var j = 0; j < renderers.length; j++) {
        var renderer = renderers[j];
        if (!renderer.isConnected) continue;
        var card = renderer.closest ? renderer.closest(AD_CARD_SELECTOR) : null;
        try {
          if (card) card.remove();
          else renderer.remove();
          removed = true;
        } catch (e) { /* next */ }
      }
    } catch (e) { /* never break the page */ }
    return removed;
  }

  function yoodInstallCosmeticLayer() {
    if (window.__YOOD_COSMETIC__) return;
    window.__YOOD_COSMETIC__ = true;
    yoodEnsureAdStyle();
    if (document.head) {
      yoodRemoveKnownAds(document);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        yoodEnsureAdStyle();
        yoodRemoveKnownAds(document);
      }, { once: true });
    }
    // Re-ensure the style element if YouTube wipes <head> children.
    try {
      var headTarget = document.head || document.documentElement;
      if (headTarget) {
        new MutationObserver(function () { yoodEnsureAdStyle(); })
          .observe(headTarget, { childList: true });
      }
    } catch (e) { /* noop */ }
  }

  // Install ad layers immediately (document_start): every millisecond of
  // delay is a chance for an ad request to slip through first.
  yoodEnsureAdStyle();
  yoodInstallCosmeticLayer();

  var SUBTITLE_LANGS = [
    ["he", "Hebrew (\u05E2\u05D1\u05E8\u05D9\u05EA)"],
    ["en", "English"],
    ["ar", "\u0627\u0644\u0639\u0631\u0628\u064A\u0629 (Arabic)"],
    ["es", "Espa\u00F1ol (Spanish)"],
    ["fr", "Fran\u00E7ais (French)"],
    ["de", "Deutsch (German)"],
    ["ru", "\u0420\u0443\u0441\u0441\u043A\u0438\u0439 (Russian)"],
    ["pt", "Portugu\u00EAs (Portuguese)"],
    ["it", "Italiano (Italian)"],
    ["nl", "Nederlands (Dutch)"],
    ["pl", "Polski (Polish)"],
    ["tr", "T\u00FCrk\u00E7e (Turkish)"],
    ["hi", "\u0939\u093F\u0928\u094D\u0926\u0940 (Hindi)"],
    ["ja", "\u65E5\u672C\u8A9E (Japanese)"],
    ["ko", "\uD55C\uAD6D\uC5B4 (Korean)"],
    ["zh-Hans", "\u4E2D\u6587\u7B80\u4F53 (Chinese Simplified)"]
  ];

  function storedSubLang() {
    try { return localStorage.getItem("yood-sub-lang") || "he"; }
    catch (e) { return "he"; }
  }
  function storeSubLang(value) {
    try { localStorage.setItem("yood-sub-lang", value); } catch (e) { /* private mode */ }
  }

  // The app window should read "Yood", not a bare "YouTube". Video pages
  // keep their video title (that is the useful behavior there).
  function retitle() {
    try {
      if (document.title === "YouTube" || document.title === "YouTube Music") {
        document.title = "Yood";
      }
    } catch (e) { /* never break the page */ }
  }

  function videoUrlFrom(card) {
    var link = card.querySelector('a[href*="/watch?v="], a[href*="/shorts/"], a[href*="/live/"], a[href*="youtu.be/"]');
    if (!link) return null;
    try {
      var url = new URL(link.href, location.href);
      if (url.hostname === "youtu.be") {
        var id = url.pathname.slice(1).split("/")[0];
        return id ? "https://www.youtube.com/watch?v=" + id : null;
      }
      return url.href;
    } catch (e) { return null; }
  }

  function handToYood(pageUrl, options, requestId) {
    var target = "yood://download?url=" + encodeURIComponent(pageUrl);
    if (requestId) target += "&request_id=" + encodeURIComponent(requestId);
    if (options) {
      if (options.mode && options.mode !== "video") target += "&mode=" + encodeURIComponent(options.mode);
      if (options.quality && options.quality !== "best") target += "&quality=" + encodeURIComponent(options.quality);
      if (options.container && options.container !== "mp4") target += "&container=" + encodeURIComponent(options.container);
      if (options.directory) target += "&directory=" + encodeURIComponent(options.directory);
      if (options.format_selector) target += "&format_selector=" + encodeURIComponent(options.format_selector);
      if (options.subtitles) {
        target += "&subtitles=1";
        if (options.subtitle_lang) target += "&subtitle_lang=" + encodeURIComponent(options.subtitle_lang);
      }
      if (options.embed_thumbnail) target += "&embed_thumbnail=1";
    }
    window.location.href = target;
  }
  function yoodDownloadPayload(pageUrl, options) {
    var payload = { url: pageUrl, context: "extension" };
    if (options) {
      if (options.mode && options.mode !== "video") payload.mode = options.mode;
      if (options.quality && options.quality !== "best") payload.quality = options.quality;
      if (options.container && options.container !== "mp4") payload.container = options.container;
      if (options.directory) payload.directory = options.directory;
      if (options.format_selector) payload.format_selector = options.format_selector;
      if (options.subtitles) {
        payload.subtitles = true;
        if (options.subtitle_lang) payload.subtitle_language = options.subtitle_lang;
      }
      if (options.embed_thumbnail) payload.embed_thumbnail = true;
    }
    return payload;
  }
  // Preferred handoff: POST straight to the backend (no external-protocol
  // navigation, so no OS "Open Yood?" prompt and no tab flash). Falls back
  // to the yood:// deep link when the backend is unreachable.
  // count: undefined = plain "sent" toast, number = "sent (N)", null = quiet.
  function yoodSendDownload(pageUrl, options, count) {
    var silent = count === null;
    var toastOrQuiet = silent ? function () { } : function () {
      try {
        laterToast(yoodT("sent") + (typeof count === "number" ? " (" + count + ")" : ""));
      } catch (e) {
        try { laterToast("Sent to Yood"); } catch (e2) { }
      }
    };
    var requestId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
    yoodDlEnsureBase(function (base) {
      if (!base) { handToYood(pageUrl, options, requestId); toastOrQuiet(); return; }
      var payload = null;
      try {
        payload = yoodDownloadPayload(pageUrl, options);
        payload.request_id = requestId;
      }
      catch (e) { handToYood(pageUrl, options, requestId); toastOrQuiet(); return; }
      yoodLocalFetch(base + "/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          if (!response.ok) {
            var error = new Error("Yood rejected the download");
            error.noFallback = true;
            throw error;
          }
          return response.json();
        })
        .then(function (data) {
          if (data && data.ok) {
            yoodDlPoll();
            toastOrQuiet();
          }
          else {
            var error = new Error("Yood rejected the download");
            error.noFallback = true;
            throw error;
          }
        })
        .catch(function (error) {
          if (!error || !error.noFallback) handToYood(pageUrl, options, requestId);
          else { try { laterToast("Yood could not queue this download"); } catch (e) { } }
          if (!error || !error.noFallback) toastOrQuiet();
        });
    });
  }

  // ---- Alt+L floating bar (top center): links, IDs, channels ----
  function parseBarInput(raw) {
    var trimmed = (raw || "").trim();
    if (!trimmed) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
      return "https://www.youtube.com/watch?v=" + trimmed;
    }
    if (/^UC[A-Za-z0-9_-]{22}$/.test(trimmed)) {
      return "https://www.youtube.com/channel/" + trimmed;
    }
    var candidate = /^https?:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
    var url;
    try { url = new URL(candidate); } catch (e) { return null; }
    if (url.protocol !== "https:") return null;
    var host = url.hostname.toLowerCase();
    if (host === "youtu.be") {
      var id = url.pathname.slice(1).split("/")[0];
      return id ? "https://www.youtube.com/watch?v=" + id + url.search : null;
    }
    var allowed = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
    for (var i = 0; i < allowed.length; i++) {
      if (host === allowed[i] || host.slice(-allowed[i].length - 1) === "." + allowed[i]) {
        return url.href;
      }
    }
    return null;
  }

  function showUrlBar() {
    var old = document.getElementById("yood-urlbar");
    if (old) {
      old.remove();
      return;
    }
    closeDialog();
    var wrap = document.createElement("div");
    wrap.id = "yood-urlbar";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Open YouTube link (Alt+L)");
    wrap.style.cssText = "position:fixed;top:12%;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(560px,calc(100vw - 48px));background:#212121;color:#f1f1f1;border:1px solid #444;border-radius:14px;box-shadow:0 12px 48px #000b;padding:16px 18px;font:14px Roboto,Arial,sans-serif;";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:12px;";
    var logo = document.createElement("span");
    logo.textContent = "Y";
    logo.setAttribute("aria-hidden", "true");
    logo.style.cssText = "flex:none;width:26px;height:26px;border-radius:50%;background:#f00;color:#fff;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;";
    var heading = document.createElement("span");
    heading.textContent = "Open in Yood";
    heading.style.cssText = "font-weight:600;";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u2715";
    close.setAttribute("aria-label", "Close (Esc)");
    close.style.cssText = "margin-left:auto;width:30px;height:30px;border:0;border-radius:50%;color:#eee;background:#ffffff14;cursor:pointer;font-size:16px;";
    head.appendChild(logo); head.appendChild(heading); head.appendChild(close);
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "YouTube link, video ID, channel ID, @handle URL…  (Alt+L)";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.style.cssText = "flex:1;min-width:0;color:#f1f1f1;background:#303030;border:1px solid #666;border-radius:8px;padding:10px 12px;font-size:14px;outline:none;";
    var go = document.createElement("button");
    go.type = "button";
    go.textContent = "Go";
    go.style.cssText = "border:0;border-radius:18px;padding:9px 18px;color:#fff;background:#065fd4;cursor:pointer;white-space:nowrap;";
    row.appendChild(input); row.appendChild(go);
    var hint = document.createElement("div");
    hint.style.cssText = "color:#aaa;font-size:12px;margin-top:10px;";
    hint.textContent = "YouTube links only — videos, channels, playlists, Shorts.";
    var error = document.createElement("div");
    error.setAttribute("role", "alert");
    error.hidden = true;
    error.style.cssText = "color:#f28b82;font-size:12px;margin-top:8px;";
    wrap.appendChild(head); wrap.appendChild(row); wrap.appendChild(hint); wrap.appendChild(error);
    (document.body || document.documentElement).appendChild(wrap);
    var closeBar = function () { wrap.remove(); };
    close.addEventListener("click", closeBar);
    var submit = function () {
      var destination = parseBarInput(input.value);
      if (!destination) {
        error.textContent = "This isn't a YouTube link, video ID or channel.";
        error.hidden = false;
        return;
      }
      error.hidden = true;
      wrap.remove();
      window.location.href = destination;
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); submit(); }
      if (event.key === "Escape") { event.preventDefault(); closeBar(); }
    });
    setTimeout(function () { input.focus(); }, 0);
  }

  document.addEventListener("keydown", function (event) {
    var tag = (event.target && event.target.tagName) || "";
    if (/^(input|textarea|select)$/i.test(tag) || (event.target && event.target.isContentEditable)) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.code === "KeyL" || event.key.toLowerCase() === "l")) {
      event.preventDefault();
      event.stopPropagation();
      var bar = document.getElementById("yood-urlbar");
      if (bar) bar.remove();
      else showUrlBar();
    }
  }, true);

  // Minimal-browser policy: DevTools must not be openable. Brave app mode
  // has no menu, so the keyboard chords are the only path — swallow them
  // in the capture phase before they reach Brave. Covers F12,
  // Ctrl+Shift+C (element picker) and the rest of the inspector chords.
  // Mirrors installDevtoolsBlock in the webview integration layer.
  document.addEventListener("keydown", function (event) {
    var key = "";
    try { key = (event.key || "").toLowerCase(); } catch (e) { key = ""; }
    if (event.key === "F12" || event.code === "F12") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey &&
      (key === "i" || key === "j" || key === "c" || key === "k" || key === "e")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.metaKey && event.altKey && (key === "i" || key === "j" || key === "c")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey && key === "u") {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // ---- Download buttons (inside YouTube's own rows) + dialog ----
  function chipButton(pageUrl) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute(MARK, pageUrl);
    button.setAttribute("aria-label", yoodT("downloadWith"));
    button.title = yoodT("downloadWith");
    button.style.cssText = "display:inline-flex;align-items:center;gap:6px;border:0;border-radius:18px;padding:8px 14px 8px 10px;margin:4px;color:#f1f1f1;background:#272727;cursor:pointer;font:500 14px Roboto,Arial,sans-serif;white-space:nowrap;";
    var icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.style.cssText = "display:inline-flex;width:24px;height:24px;";
    icon.innerHTML = DOWNLOAD_SVG;
    var label = document.createElement("span");
    try { label.textContent = yoodT("downloadWith"); } catch (e) { label.textContent = "Download with Yood"; }
    button.appendChild(icon);
    button.appendChild(label);
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      showDownloadDialog(pageUrl);
    });
    return button;
  }

  // YouTube reuses #top-level-buttons-computed in several places, including
  // HIDDEN engagement-panel headers (duplicate IDs!). Always pick a host
  // that is actually visible, otherwise the button renders at 0x0.
  // NOTE: keep this selector list a superset of the reference project's
  // list, in the same order — the download button must look and sit
  // exactly like there (same dark pill inside YouTube's own rows). The
  // extra variants only extend coverage to newer YouTube DOM where nodes
  // were renamed; they add no new styling.
  function yoodDepth(el) {
    var d = 0;
    try { var n = el; while (n && n.parentNode) { d++; n = n.parentNode; } } catch (e) { }
    return d;
  }
  function visibleActionsHost() {
    var candidates = document.querySelectorAll("ytd-watch-metadata #top-level-buttons-computed, #top-level-buttons-computed, ytd-watch-metadata #actions-inner, ytd-watch-metadata #actions, ytd-reel-player-header-renderer #actions, ytd-reel-player-overlay-renderer #actions, ytd-shorts #actions, ytd-reel-video-renderer #actions, #top-level-buttons");
    var fallback = null;
    var best = null, bestDepth = -1;
    for (var i = 0; i < candidates.length; i++) {
      var h = candidates[i];
      if (!(h instanceof Element)) continue;
      if (h.closest("ytd-engagement-panel-section-list-renderer, ytd-engagement-panel-title-header-renderer, [hidden]")) continue;
      if (!fallback) fallback = h;
      var r;
      try { r = h.getBoundingClientRect(); } catch (e) { continue; }
      if (!(r.width > 40 && r.height > 0)) continue;
      // Prefer the DEEPEST visible candidate: outer containers
      // (#actions-inner, #actions) otherwise win by document order and the
      // button lands outside the Like/Share/Save row.
      var d = yoodDepth(h);
      if (d <= bestDepth) continue;
      // Never pick a container that wraps another candidate row.
      var wrapsRow = false;
      try {
        for (var j = 0; j < candidates.length; j++) {
          var o = candidates[j];
          if (o !== h && o instanceof Element && h.contains(o)) { wrapsRow = true; break; }
        }
      } catch (e) { wrapsRow = false; }
      if (wrapsRow) continue;
      best = h; bestDepth = d;
    }
    return best || fallback;
  }

  // Row anchor: Download sits directly left of ⋮ in RTL (between Share
  // and ⋮), falling back to Save and finally to the row end when YouTube
  // renames its buttons. The ⋮ is matched by aria-label too (Hebrew UI:
  // "פעולות נוספות"), because Shorts does not always wrap it in
  // ytd-menu-renderer.
  function rowAnchor(host) {
    // Download sits BETWEEN Save and Share (never after the overflow menu).
    // yoodFindActionAnchor is multilingual + positional, so it works in every
    // YouTube UI language; the deep-menu fallback below only runs when it
    // finds nothing.
    try {
      var anchored = yoodFindActionAnchor(host);
      if (anchored) return anchored;
    } catch (e) { /* fall through to legacy scan */ }
    var kids = [];
    try { kids = host.children; } catch (e) { return null; }
    var save = null, overflow = null;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (!(k instanceof Element)) continue;
      if (k.hasAttribute(MARK) || k.hasAttribute("data-yood-main")) continue;
      var text = "";
      try { text = (k.textContent || "").trim(); } catch (e) { text = ""; }
      var aria = "";
      try { aria = (k.getAttribute("aria-label") || "").trim(); } catch (e) { aria = ""; }
      if (!save && (/^(שמירה|Save)$/i.test(text) || /^(שמירה|Save)$/i.test(aria))) save = k;
      if (!overflow) {
        var tag = "";
        try { tag = k.tagName.toLowerCase(); } catch (e) { tag = ""; }
        if (tag === "ytd-menu-renderer") overflow = k;
        else if (/פעולות נוספות|more actions|additional actions/i.test(aria)) overflow = k;
      }
      if (save && overflow) break;
    }
    if (save) return save;
    if (overflow) return overflow;
    try {
      var deep = host.querySelector("ytd-menu-renderer");
      if (deep) {
        var up = deep;
        while (up && up.parentNode !== host) up = up.parentNode;
        if (up && up.parentNode === host && up instanceof Element &&
          !up.hasAttribute(MARK) && !up.hasAttribute("data-yood-main")) return up;
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  function yoodIsPlaylistPage() {
    try { return /youtube\.com\/playlist\?[^#]*list=/i.test(location.href); } catch (e) { return false; }
  }
  function yoodIsChannelPage() {
    try { return /youtube\.com\/(channel\/|c\/|@)/i.test(location.href); } catch (e) { return false; }
  }
  function yoodHasListPanel() {
    try {
      var p = document.querySelector("ytd-playlist-panel-renderer, ytmusic-player-queue");
      if (p && p.isConnected) {
        if (/[?&]list=/i.test(location.href)) return true;
        try {
          var r = p.getBoundingClientRect();
          if (r.width > 40 && r.height > 0) return /[?&]list=/i.test(location.href);
        } catch (e) { return /[?&]list=/i.test(location.href); }
      }
    } catch (e) { }
    return false;
  }
  function yoodIsMusicPage() {
    try { return /(^|\.)music\.youtube\.com$/i.test(location.hostname); } catch (e) { return false; }
  }
  function yoodPlaylistUrlsFromDom(limit) {
    var out = [], seen = {};
    try {
      var links = document.querySelectorAll("ytd-playlist-video-renderer a[href*=\"/watch\"], ytd-playlist-panel-video-renderer a[href*=\"/watch\"], ytmusic-responsive-list-item-renderer a[href*=\"/watch\"], ytmusic-player-queue-item a[href*=\"/watch\"]");
      for (var i = 0; i < links.length; i++) {
        if (limit && out.length >= limit) break;
        var href = "";
        try { href = links[i].href; } catch (e) { href = ""; }
        if (!href) continue;
        var full = "";
        try { full = new URL(href, location.href).href; } catch (e) { continue; }
        if (!/\/watch/i.test(full)) continue;
        var id = "";
        try { id = new URL(full).searchParams.get("v") || full; } catch (e) { id = full; }
        if (!id || seen[id]) continue;
        seen[id] = true;
        out.push(full);
      }
    } catch (e) { /* dom changed */ }
    return out;
  }
  function yoodDownloadPlaylistFromDom() {
    var urls = yoodPlaylistUrlsFromDom(200);
    if (!urls.length) {
      try { handToYood(location.href, { mode: "video" }); } catch (e) { }
      try { laterToast(yoodT("sent")); } catch (e2) { }
      return;
    }
    showPlaylistConfirm(urls);
  }
  function yoodSendPlaylist(urls) {
    try { laterToast(yoodT("sent") + " (" + urls.length + ")"); } catch (e) { }
    for (var i = 0; i < urls.length; i++) {
      (function (u, k) {
        setTimeout(function () { try { yoodSendDownload(u, { mode: "video" }, null); } catch (e) { } }, k * 600);
      })(urls[i], i);
    }
  }
  // Explicit confirmation: states plainly that the WHOLE playlist (all N
  // videos) will be downloaded — no silent surprises.
  function showPlaylistConfirm(urls) {
    closeDialog();
    var overlay = document.createElement("div");
    overlay.className = "yood-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:14px Roboto,Arial,sans-serif;";
    var card = document.createElement("section");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.style.cssText = "width:min(440px,calc(100vw - 32px));background:" + YT_BG + ";color:" + YT_TEXT + ";border-radius:12px;box-shadow:0 8px 40px #000c;padding:20px;";
    var title = document.createElement("div");
    title.style.cssText = "font-size:16px;font-weight:500;margin-bottom:10px;";
    try { title.textContent = yoodT("playlistTitle") + " (" + urls.length + ")"; }
    catch (e) { title.textContent = "Download entire playlist (" + urls.length + ")"; }
    var body = document.createElement("div");
    body.style.cssText = "font-size:14px;color:" + YT_MUTED + ";line-height:1.5;margin-bottom:18px;";
    try { body.textContent = yoodT("playlistConfirm").split("{n}").join(String(urls.length)); }
    catch (e) { body.textContent = "This will download all " + urls.length + " videos in this playlist."; }
    var foot = document.createElement("div");
    foot.style.cssText = "display:flex;justify-content:flex-end;gap:4px;";
    var cancel = document.createElement("button");
    cancel.type = "button";
    try { cancel.textContent = yoodT("cancel"); } catch (e) { cancel.textContent = "Cancel"; }
    cancel.style.cssText = "border:0;border-radius:18px;padding:10px 16px;color:" + YT_BLUE + ";background:transparent;font-size:14px;font-weight:500;cursor:pointer;";
    cancel.addEventListener("click", closeDialog);
    var start = document.createElement("button");
    start.type = "button";
    try { start.textContent = yoodT("downloadAll"); } catch (e) { start.textContent = "Download all"; }
    start.style.cssText = "border:0;border-radius:18px;padding:10px 16px;color:#fff;background:" + YT_PRIMARY + ";font-size:14px;font-weight:500;cursor:pointer;";
    start.addEventListener("click", function () {
      try {
        var folder = "";
        try { folder = localStorage.getItem("yood-download-folder") || ""; } catch (e) { folder = ""; }
        if (folder) {
          try { laterToast(yoodT("sent") + " (" + urls.length + ")"); } catch (e3) { }
          for (var i = 0; i < urls.length; i++) {
            (function (u, k) {
              setTimeout(function () {
                try { yoodSendDownload(u, { mode: "video", directory: folder }, null); } catch (e2) { }
              }, k * 600);
            })(urls[i], i);
          }
        } else {
          yoodSendPlaylist(urls);
        }
      } catch (e) { yoodSendPlaylist(urls); }
      closeDialog();
    });
    foot.appendChild(cancel);
    foot.appendChild(start);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(foot);
    overlay.appendChild(card);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) closeDialog(); });
    try { yoodDialogParent().appendChild(overlay); }
    catch (e) { try { document.body.appendChild(overlay); } catch (e2) { } }
  }
  function injectPlaylistButton() {
    try {
      var url = location.href;
      // Always clean orphans first (e.g. left behind after SPA navigation
      // away from a playlist), even when there is no playlist here now.
      var stale = document.querySelectorAll("[" + MARK + "][data-yood-playlist]");
      for (var s = 0; s < stale.length; s++) {
        var n = stale[s];
        try {
          if (!(n.isConnected && n.getAttribute(MARK) === url)) dropMainButton(n);
        } catch (e) { try { dropMainButton(n); } catch (e2) { } }
      }
      if (!yoodIsPlaylistPage() && !yoodIsChannelPage() && !yoodHasListPanel() && !yoodIsMusicPage()) return;
      var live = document.querySelector("[" + MARK + "][data-yood-playlist]");
      if (live && live.isConnected && live.getAttribute(MARK) === url) {
        try {
          var lbl = live.querySelector("span:last-child");
          var want = yoodT("download");
          if (lbl && lbl.textContent !== want) lbl.textContent = want;
        } catch (e) { }
        return;
      }
      var hosts = document.querySelectorAll("ytd-playlist-header-renderer #actions, ytd-playlist-sidebar-primary-info-renderer #actions, ytd-playlist-panel-renderer #header-actions, ytd-playlist-panel-renderer #menu, ytd-playlist-panel-renderer #header, ytd-c4-tabbed-header-renderer #actions, ytd-browse #header #actions, ytd-playlist-header-renderer, #header ytd-playlist-header-renderer, ytmusic-player-queue #header, ytmusic-player-queue #menu");
      var host = null;
      for (var i = 0; i < hosts.length; i++) {
        var h = hosts[i];
        if (!(h instanceof Element) || !h.isConnected) continue;
        if (h.closest && h.closest("[hidden]")) continue;
        var r = null;
        try { r = h.getBoundingClientRect(); } catch (e) { continue; }
        if (r && r.width > 40 && r.height > 0) { host = h; break; }
        if (!host) host = h;
      }
      var button = chipButton(url);
      button.setAttribute("data-yood-playlist", "true");
      button.setAttribute("data-yood-main", "true");
      // Re-wire click: playlist collects every item instead of opening the single-video dialog.
      try {
        var nb = chipButton(url);
        nb.setAttribute("data-yood-playlist", "true");
        nb.setAttribute("data-yood-main", "true");
        nb.addEventListener("click", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          yoodDownloadPlaylistFromDom();
        });
        button = nb;
      } catch (e) {
        button.addEventListener("click", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          yoodDownloadPlaylistFromDom();
        });
      }
      if (host) {
        try { host.appendChild(button); } catch (e) { /* fallback below */ }
        if (button.isConnected) return;
      }
      if (document.body) {
        var wrap = document.createElement("div");
        wrap.setAttribute("data-yood-main", "true");
        wrap.setAttribute("data-yood-playlist", "true");
        wrap.style.cssText = "position:fixed;left:16px;bottom:112px;z-index:2147483640;";
        wrap.appendChild(button);
        document.body.appendChild(wrap);
      }
    } catch (e) { /* never break the page */ }
  }
  function injectVideoButton() {
    var url = location.href;
    try { injectPlaylistButton(); } catch (e) { }
    // Drop watch pills from other videos/pages even when this page has no
    // watch button (e.g. SPA navigation to a playlist or channel).
    try {
      var orphans = document.querySelectorAll("[" + MARK + "][data-yood-main]:not([data-yood-playlist])");
      for (var o = 0; o < orphans.length; o++) {
        var on = orphans[o];
        try {
          if (!(on.isConnected && on.getAttribute(MARK) === url)) dropMainButton(on);
        } catch (e) { try { dropMainButton(on); } catch (e2) { } }
      }
    } catch (e) { }
    if (!/youtube\.com\/(watch|shorts\/|live\/)/i.test(url)) return;
    var isShorts = /youtube\.com\/shorts\//i.test(url);
    var host = visibleActionsHost();
    // Drop stale buttons: wrong video, detached, hidden — or parked in the
    // floating fallback while a real host is now visible. YouTube renders
    // its rows lazily, so the fallback often wins the first race; without
    // the re-homing check the button would sit bottom-left forever instead
    // of moving into the Like/Share/Save row once it exists.
    var mains = document.querySelectorAll("[" + MARK + "][data-yood-main]:not([data-yood-playlist])");
    var good = null;
    for (var i = 0; i < mains.length; i++) {
      var node = mains[i];
      var rect = null;
      try { rect = node.getBoundingClientRect(); } catch (e) { rect = null; }
      if (!(node.isConnected && node.getAttribute(MARK) === url && rect && rect.width > 40 && rect.height > 0)) {
        dropMainButton(node);
        continue;
      }
      if (host && !host.contains(node)) {
        // On Shorts the chip lives inside a rail container rather than the
        // returned host — that IS home, keep it (avoids remove/re-add
        // churn every scan when several rail candidates are visible).
        var inRail = false;
        try {
          inRail = isShorts && !!node.closest("ytd-shorts, ytd-reel-video-renderer, ytd-reel-player-overlay-renderer, ytd-reel-player-header-renderer");
        } catch (e) { inRail = false; }
        if (!inRail) {
          dropMainButton(node);
          continue;
        }
      }
      if (!good) good = node;
      else dropMainButton(node);
    }
    if (good) return;
    if (isShorts) {
      injectShortsChip(url);
      return;
    }
    var button = chipButton(url);
    button.setAttribute("data-yood-main", "true");
    if (host) {
      // Between Share and Save (rowAnchor), never dangling at the row end.
      host.insertBefore(button, rowAnchor(host));
    } else if (document.body) {
      var wrap = document.createElement("div");
      wrap.setAttribute("data-yood-main", "true");
      wrap.style.cssText = "position:fixed;left:16px;bottom:64px;z-index:2147483640;";
      wrap.appendChild(button);
      document.body.appendChild(wrap);
    }
  }

  // Removes a main button plus its wrapper when the wrapper is left empty
  // (floating fallback / Shorts slot). Prevents empty shells piling up
  // across SPA navigations.
  function dropMainButton(node) {
    var shell = null;
    try {
      var parent = node.parentNode;
      if (parent && parent instanceof Element && parent !== document.body &&
        parent.hasAttribute("data-yood-main") && !parent.hasAttribute(MARK)) {
        shell = parent;
      }
    } catch (e) { shell = null; }
    try { node.remove(); } catch (e) { /* gone */ }
    try {
      if (shell && shell.childNodes.length === 0) shell.remove();
    } catch (e) { /* keep */ }
  }

  // Player control-bar button: the ONLY Yood control visible while the
  // player is fullscreen (page pills are covered by the fullscreen layer).
  // Lives inside #movie_player's own right-controls, so fullscreen keeps it.
  function ensurePlayerButton() {
    try {
      if (!/youtube\.com\/(watch|shorts\/|live\/)/i.test(location.href)) return;
      var player = document.getElementById("movie_player");
      if (!player || !player.isConnected) return;
      if (player.querySelector("[data-yood-player]")) return;
      var bar = null;
      try { bar = player.querySelector(".ytp-right-controls"); } catch (e) { bar = null; }
      if (!bar || !bar.isConnected) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-yood-player", "true");
      btn.className = "ytp-button";
      try { btn.setAttribute("aria-label", yoodT("downloadWith")); btn.title = yoodT("downloadWith"); }
      catch (e) { btn.setAttribute("aria-label", "Download with Yood"); }
      btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;cursor:pointer;";
      var ic = document.createElement("span");
      ic.setAttribute("aria-hidden", "true");
      ic.style.cssText = "display:inline-flex;width:24px;height:24px;color:#fff;";
      try { ic.innerHTML = DOWNLOAD_SVG; } catch (e) { }
      btn.appendChild(ic);
      btn.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) { }
        try { showDownloadDialog(location.href); } catch (e2) { }
      });
      bar.insertBefore(btn, bar.firstChild);
    } catch (e) { /* player not ready; next scan retries */ }
  }
  // Shorts rail candidates, visible one preferred inside the active reel.
  function shortsRail() {
    var rails = document.querySelectorAll("ytd-reel-player-overlay-renderer #actions, ytd-shorts #actions, ytd-reel-video-renderer #actions, ytd-reel-player-header-renderer #actions");
    var fallback = null;
    for (var i = 0; i < rails.length; i++) {
      var rail = rails[i];
      if (!(rail instanceof Element) || !rail.isConnected) continue;
      if (rail.closest("[hidden]")) continue;
      var rect = null;
      try { rect = rail.getBoundingClientRect(); } catch (e) { continue; }
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      try {
        if (rail.closest("ytd-reel-video-renderer[is-active]")) return rail;
      } catch (e) { /* noop */ }
      if (!fallback) fallback = rail;
    }
    return fallback;
  }

  // The rail action labelled "Share" — the chip goes directly beneath it.
  function shortsShareAnchor(rail) {
    var kids = rail.children;
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (!(kid instanceof Element)) continue;
      if (kid.hasAttribute(MARK)) continue;
      var combined = "";
      try { combined = ((kid.getAttribute("aria-label") || "") + " " + (kid.textContent || "")).trim().toLowerCase(); } catch (e) { combined = ""; }
      for (var s = 0; s < YOOD_SHARE_WORDS.length; s++) {
        var w = YOOD_SHARE_WORDS[s];
        if (w && combined && combined.indexOf(w) !== -1) return kid;
      }
      try {
        var inner = kid.querySelector("[aria-label]");
        if (inner) {
          var ia = "";
          try { ia = (inner.getAttribute("aria-label") || "").toLowerCase(); } catch (e2) { ia = ""; }
          for (var t = 0; t < YOOD_SHARE_WORDS.length; t++) {
            var w2 = YOOD_SHARE_WORDS[t];
            if (w2 && ia && ia.indexOf(w2) !== -1) return kid;
          }
        }
      } catch (e) { /* next */ }
    }
    return null;
  }

  // Shorts: the SAME dark pill as everywhere else, inserted into the rail
  // directly beneath the Share button (between Share and ⋮). Only when no
  // rail exists at all does it fall back to the floating bottom-left chip.
  function injectShortsChip(url) {
    // One pill per video: a live pill for this video stays (no restack
    // every scan); detached pills or pills for other videos are dropped.
    var live = document.querySelectorAll("[" + MARK + "][data-yood-main]");
    for (var k = 0; k < live.length; k++) {
      var cur = live[k];
      var same = false;
      try { same = cur.isConnected && cur.getAttribute(MARK) === url; } catch (e) { same = false; }
      if (!same) { dropMainButton(cur); continue; }
      var inRail = false;
      try {
        inRail = !!cur.closest("ytd-shorts, ytd-reel-video-renderer, ytd-reel-player-overlay-renderer, ytd-reel-player-header-renderer");
      } catch (e) { inRail = false; }
      if (inRail) return;
      dropMainButton(cur);
    }
    var button = chipButton(url);
    button.setAttribute("data-yood-main", "true");
    var rail = shortsRail();
    if (rail) {
      var slot = document.createElement("div");
      slot.setAttribute("data-yood-main", "true");
      slot.style.cssText = "display:flex;justify-content:center;margin:6px 0;max-width:100%;";
      slot.appendChild(button);
      var anchor = shortsShareAnchor(rail);
      try {
        rail.insertBefore(slot, anchor ? anchor.nextSibling : null);
      } catch (e) { /* detached rail; fall through to fallback */ }
      if (slot.isConnected) return;
      try { slot.remove(); } catch (e2) { /* noop */ }
      button = chipButton(url);
      button.setAttribute("data-yood-main", "true");
    }
    if (document.body) {
      var wrap = document.createElement("div");
      wrap.setAttribute("data-yood-main", "true");
      wrap.style.cssText = "position:fixed;left:16px;bottom:64px;z-index:2147483640;";
      wrap.appendChild(button);
      document.body.appendChild(wrap);
    }
  }

  // ⋮ overflow menus get Yood items: feed cards offer Download + Watch
  // later, watch/Shorts pages offer Watch later (Download already sits in
  // the action row). The menu renders on demand, so the opener click
  // stashes the video and the popup gets its items immediately via the
  // menu observer below (no waiting for the next debounced scan).
  var LATER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Zm4.2 14.2L11 13.5V7h1.5v5.6l4.5 2.7-.8 1.9Z" fill="currentColor"></path></svg>';
  var yoodMenuContext = null;
  function yoodPathEls(ev) {
    try { if (ev.composedPath) return ev.composedPath(); } catch (e) { }
    var t = null;
    try { t = ev.target instanceof Element ? ev.target : null; } catch (e) { t = null; }
    return t ? [t] : [];
  }
  function yoodCaptureMenuContext(ev) {
    try {
      yoodMenuContext = null;
      var path = yoodPathEls(ev);
      var menu = null, card = null;
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (!(n instanceof Element)) continue;
        if (!menu) {
          try {
            var tag = (n.tagName || "").toLowerCase();
            if (tag === "ytd-menu-renderer") menu = n;
            else if (n.closest) { var m = n.closest("ytd-menu-renderer"); if (m) menu = m; }
          } catch (e) { }
        }
        if (!card) {
          try {
            if (n.matches && n.matches(CARD_SELECTOR)) card = n;
            else if (n.closest) { var c = n.closest(CARD_SELECTOR); if (c) card = c; }
          } catch (e) { }
        }
        if (menu && card) break;
      }
      if (menu && !card) { try { card = menu.closest(CARD_SELECTOR); } catch (e) { } }
      if (card) {
        var entry = null;
        try { entry = wlCardEntry(card); } catch (e) { entry = null; }
        if (entry && entry.url) {
          yoodMenuContext = { url: entry.url, source: "card", title: entry.title, channel: entry.channel, thumb: entry.thumb, ts: Date.now() };
          return;
        }
      }
      if (menu) {
        try {
          var pl = menu.closest ? menu.closest("ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer") : null;
          if (pl) {
            var pe = null;
            try { pe = wlCardEntry(pl); } catch (e) { pe = null; }
            if (pe && pe.url) {
              yoodMenuContext = { url: pe.url, source: "card", title: pe.title, channel: pe.channel, thumb: pe.thumb, ts: Date.now() };
              return;
            }
          }
        } catch (e) { }
        if (/youtube\.com\/(watch|shorts\/|live\/|playlist)/i.test(location.href)) {
          yoodMenuContext = { url: location.href, source: "page", title: "", channel: "", thumb: "", ts: Date.now() };
          return;
        }
        var watchHost = null;
        try { watchHost = menu.closest("ytd-watch-metadata, #top-level-buttons-computed, #actions"); } catch (e) { }
        if (watchHost && /youtube\.com\/(watch|shorts\/|live\/)/i.test(location.href)) {
          yoodMenuContext = { url: location.href, source: "page", title: "", channel: "", thumb: "", ts: Date.now() };
          return;
        }
      }
      if (/youtube\.com\/shorts\//i.test(location.href)) {
        try {
          for (var k = 0; k < path.length; k++) {
            var b = path[k];
            if (b instanceof Element && (b.tagName || "").toLowerCase() === "button") {
              var al = "";
              try { al = (b.getAttribute("aria-label") || "").toLowerCase(); } catch (e) { al = ""; }
              var hit = /more|additional/.test(al);
              if (!hit) {
                for (var w = 0; w < YOOD_MORE_WORDS.length; w++) {
                  if (YOOD_MORE_WORDS[w] && al && al.indexOf(YOOD_MORE_WORDS[w]) !== -1) { hit = true; break; }
                }
              }
              if (hit) { yoodMenuContext = { url: location.href, source: "page", title: "", channel: "", thumb: "", ts: Date.now() }; return; }
            }
          }
        } catch (e) { }
      }
    } catch (e) { yoodMenuContext = null; }
  }
  var yoodLastPointerPath = null;
  var yoodCaptureFromPath = function (path) {
    // Shared core of yoodCaptureMenuContext, usable with a stored path when
    // a popup opens without fresh context (e.g. opener used an unknown
    // button shape). Returns true when context was set.
    try {
      var menu = null, card = null;
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (!(n instanceof Element)) continue;
        if (!menu) {
          try {
            var tag = (n.tagName || "").toLowerCase();
            if (tag === "ytd-menu-renderer" || tag === "yt-menu-renderer") menu = n;
            else if (n.closest) {
              var m = n.closest("ytd-menu-renderer, yt-menu-renderer");
              if (m) menu = m;
            }
          } catch (e) { }
        }
        if (!card) {
          try {
            if (n.matches && n.matches(CARD_SELECTOR)) card = n;
            else if (n.closest) { var c = n.closest(CARD_SELECTOR); if (c) card = c; }
          } catch (e) { }
        }
        // Overflow button without a renderer wrapper but inside a card
        // (newer lockup DOM): a more-actions button implies its card.
        if (!card) {
          try {
            if ((n.tagName || "").toLowerCase() === "button" && n.closest) {
              var al = (n.getAttribute("aria-label") || "").toLowerCase();
              var hit = /more|additional/.test(al);
              if (!hit) {
                for (var w = 0; w < YOOD_MORE_WORDS.length; w++) {
                  if (YOOD_MORE_WORDS[w] && al && al.indexOf(YOOD_MORE_WORDS[w]) !== -1) { hit = true; break; }
                }
              }
              if (hit) { var cc = n.closest(CARD_SELECTOR); if (cc) { card = cc; menu = menu || n; } }
            }
          } catch (e) { }
        }
        if (menu && card) break;
      }
      if (menu && !card) { try { card = menu.closest(CARD_SELECTOR); } catch (e) { } }
      if (card) {
        var entry = null;
        try { entry = wlCardEntry(card); } catch (e) { entry = null; }
        if (entry && entry.url) {
          yoodMenuContext = { url: entry.url, source: "card", title: entry.title, channel: entry.channel, thumb: entry.thumb, ts: Date.now() };
          return true;
        }
      }
    } catch (e) { }
    return false;
  };
  document.addEventListener("pointerdown", function (event) {
    try { yoodLastPointerPath = yoodPathEls(event); } catch (e) { }
    try { yoodCaptureMenuContext(event); } catch (e) { }
  }, true);
  document.addEventListener("mousedown", function (event) { try { yoodCaptureMenuContext(event); } catch (e) { } }, true);
  document.addEventListener("click", function (event) { try { yoodCaptureMenuContext(event); } catch (e) { } }, true);
  function yoodCloseMenu() {
    try {
      // Let YouTube close its own menu first.
      document.documentElement.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    } catch (e) { /* overlay covers it anyway */ }
  }
  function yoodMenuItem(url, svg, label) {
    var item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    item.setAttribute("tabindex", "0");
    // Roomy rows like YouTube's own items so nothing renders cramped.
    item.style.cssText = "display:flex;align-items:center;gap:16px;min-height:48px;padding:10px 20px;cursor:pointer;font:400 15px Roboto,Arial,sans-serif;color:#f1f1f1;white-space:nowrap;box-sizing:border-box;";
    var icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.style.cssText = "display:inline-flex;width:24px;height:24px;flex:none;";
    icon.innerHTML = svg;
    var text = document.createElement("span");
    text.textContent = label;
    item.appendChild(icon);
    item.appendChild(text);
    item.onmouseenter = function () { try { item.style.background = "#3d3d3d"; } catch (e) { } };
    item.onmouseleave = function () { try { item.style.background = "transparent"; } catch (e) { } };
    return item;
  }
  function injectMenuDownload() {
    if (!yoodMenuContext || !yoodMenuContext.url) return;
    try { if (yoodMenuContext.ts && (Date.now() - yoodMenuContext.ts) > 8000) { yoodMenuContext = null; return; } } catch (e) { }
    if ((!yoodMenuContext || !yoodMenuContext.url) && yoodLastPointerPath) {
      try { yoodCaptureFromPath(yoodLastPointerPath); } catch (e) { }
    }
    if (!yoodMenuContext || !yoodMenuContext.url) return;
    var ctx = yoodMenuContext;
    var popups = null;
    try { popups = document.querySelectorAll("ytd-menu-popup-renderer, tp-yt-paper-dialog, yt-sheet-view-model, yt-list-view-model, ytd-popup-container ytd-menu-popup-renderer"); } catch (e) { return; }
    if (!popups || !popups.length) {
      // Unknown wrapper: fall back to any open container holding menu items.
      try {
        var itemsNow = document.querySelectorAll("ytd-popup-container ytd-menu-service-item-renderer, tp-yt-iron-dropdown ytd-menu-service-item-renderer, ytd-popup-container [role='menuitem'], tp-yt-iron-dropdown [role='menuitem']");
        if (itemsNow && itemsNow.length) {
          var first = itemsNow[0];
          var holder = first.parentNode instanceof Element ? first.parentNode : null;
          if (holder) popups = [holder];
          else { return; }
        } else { return; }
      } catch (e) { return; }
    }
    for (var i = 0; i < popups.length; i++) {
      var popup = popups[i];
      if (!(popup instanceof Element) || !popup.isConnected) continue;
      if (popup.querySelector("[data-yood-menu]")) continue;
      var list = null;
      try { list = popup.querySelector("tp-yt-paper-listbox, [role='menu'], [role='listbox'], yt-list-view-model, #items"); } catch (e) { list = null; }
      if (!list) {
        try {
          var firstItem = popup.querySelector("[role='menuitem'], ytd-menu-service-item-renderer, yt-list-view-model [role='button']");
          list = firstItem && firstItem.parentNode instanceof Element ? firstItem.parentNode : null;
        } catch (e) { list = null; }
      }
      if (!list) {
        try {
          var anyItem = popup.querySelector("ytd-menu-service-item-renderer, [role='menuitem']");
          if (anyItem && anyItem.parentNode instanceof Element) list = anyItem.parentNode;
          else if (popup instanceof Element) list = popup;
        } catch (e) { list = null; }
      }
      if (!list) continue;
      // Roomy popup: some menus (notably Shorts) size to the first
      // rendered content and come out cramped — guarantee breathing room.
      try { popup.style.minWidth = "150px"; } catch (e) { /* cosmetic */ }
      var anchor = null;
      try { anchor = list.firstChild; } catch (e) { anchor = null; }
      if (ctx.source === "card") {
        var download = yoodMenuItem(ctx.url, DOWNLOAD_SVG, yoodT("downloadWith"));
        download.setAttribute("data-yood-menu", "download");
        download.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          yoodMenuContext = null;
          yoodCloseMenu();
          showDownloadDialog(ctx.url);
        });
        try { list.insertBefore(download, anchor); anchor = download.nextSibling; } catch (e) { /* next popup */ }
      }
      var saved = false;
      try { saved = !!wlFind(ctx.url); } catch (e) { saved = false; }
      var later = yoodMenuItem(ctx.url, LATER_SVG, saved ? yoodT("saved") : yoodT("watchLater"));
      later.setAttribute("data-yood-menu", "later");
      later.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        yoodMenuContext = null;
        yoodCloseMenu();
        try {
          if (wlFind(ctx.url)) {
            var existing = wlFind(ctx.url);
            if (existing) wlRemove(existing.id);
            laterToast(yoodT("removedFrom"));
          } else if (ctx.source === "card") {
            wlAdd({ url: ctx.url, title: ctx.title, channel: ctx.channel, thumb: ctx.thumb });
            laterToast(yoodT("savedTo"));
          } else {
            if (wlToggle(ctx.url)) laterToast(yoodT("savedTo"));
            else laterToast(yoodT("removedFrom"));
          }
        } catch (e) { /* never break the page */ }
      });
      try { list.insertBefore(later, anchor); } catch (e) { /* next popup */ }
    }
  }
  function injectCardButton(card) {
    if (card.querySelector("[" + MARK + "]")) return;
    var url = videoUrlFrom(card);
    if (!url) return;
    var host = card.querySelector("#menu, #buttons, #menu-container") || card;
    host.appendChild(chipButton(url));
  }

  function yoodDialogParent() {
    // Overlays appended to <body> are invisible while a player is
    // fullscreen (only the fullscreen element's subtree is rendered).
    // Parenting to the fullscreen element keeps Yood dialogs and toasts
    // visible in fullscreen too.
    try {
      var fs = document.fullscreenElement;
      if (fs && fs.isConnected) return fs;
    } catch (e) { /* body fallback */ }
    return document.body;
  }
  function closeDialog() {
    var overlays = document.querySelectorAll(".yood-overlay");
    for (var i = 0; i < overlays.length; i++) {
      try { overlays[i].remove(); } catch (e) { }
    }
  }

  // ---- Download dialog, styled like YouTube's own menus ----
  var YT_BG = "#212121";
  var YT_HOVER = "#3d3d3d";
  var YT_TEXT = "#f1f1f1";
  var YT_MUTED = "#aaa";
  var YT_BLUE = "#3ea6ff";
  var YT_PRIMARY = "#065fd4";

  function ytRow(label, sub, selected, disabled) {
    var row = document.createElement("div");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", selected ? "true" : "false");
    row.style.cssText = "display:flex;align-items:center;gap:14px;padding:11px 16px;cursor:" +
      (disabled ? "default" : "pointer") + ";opacity:" + (disabled ? ".45" : "1") + ";";
    var radio = document.createElement("span");
    radio.setAttribute("aria-hidden", "true");
    radio.style.cssText = "flex:none;width:18px;height:18px;border-radius:50%;border:2px solid " +
      (selected ? YT_BLUE : "#909090") + ";display:inline-flex;align-items:center;justify-content:center;";
    if (selected) {
      var dot = document.createElement("span");
      dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:" + YT_BLUE + ";";
      radio.appendChild(dot);
    }
    var texts = document.createElement("span");
    texts.style.cssText = "flex:1;min-width:0;";
    var main = document.createElement("div");
    main.style.cssText = "font-size:14px;color:" + YT_TEXT + ";";
    main.textContent = label;
    texts.appendChild(main);
    if (sub) {
      var secondary = document.createElement("div");
      secondary.style.cssText = "font-size:12px;color:" + YT_MUTED + ";margin-top:2px;";
      secondary.textContent = sub;
      texts.appendChild(secondary);
    }
    row.appendChild(radio);
    row.appendChild(texts);
    if (!disabled) {
      row.addEventListener("mouseenter", function () { row.style.background = YT_HOVER; });
      row.addEventListener("mouseleave", function () { row.style.background = "transparent"; });
    }
    return row;
  }

  function ytSectionHeader(text) {
    var el = document.createElement("div");
    el.style.cssText = "font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:" + YT_MUTED + ";padding:14px 16px 4px;";
    el.textContent = text;
    return el;
  }

  // defaults.json is deliberately read through the service worker rather than
  // exposed as a web-accessible resource, so a page cannot steal its token.
  function yoodReadDefaults() {
    return new Promise(function (resolve, reject) {
      try {
        var runtime = (typeof browser !== "undefined" && browser.runtime)
          ? browser
          : (typeof chrome !== "undefined" ? chrome : null);
        if (!runtime) { reject(new Error("extension runtime unavailable")); return; }
        runtime.runtime.sendMessage({ type: "yood-defaults" }, resolve);
      } catch (error) {
        reject(error);
      }
    });
  }

  // "Save to" prefill: the last used folder wins; otherwise the backend's
  // current default folder (published per launch as defaults.json next to
  // the extension); otherwise the "Default folder" placeholder stays.
  function loadDefaultFolder(input) {
    var fill = function (dir) {
      if (dir && !input.value) {
        try { input.value = dir; } catch (e) { /* keep placeholder */ }
      }
    };
    try {
      var remembered = null;
      try { remembered = localStorage.getItem("yood-download-folder") || ""; } catch (e) { remembered = ""; }
      if (remembered) { input.value = remembered; return; }
      yoodReadDefaults()
        .then(function (data) {
          if (data && typeof data.download_directory === "string" && data.download_directory) fill(data.download_directory);
        })
        .catch(function () { /* placeholder stays when unreachable */ });
    } catch (e) { /* placeholder stays */ }
  }
  function showDownloadDialog(pageUrl) {
    closeDialog();
    var bar = document.getElementById("yood-urlbar");
    if (bar) bar.remove();
    var state = {
      mode: "video",
      quality: "best",
      container: "mp4",
      subtitles: false,
      subtitle_lang: storedSubLang(),
      format_selector: "",
      embed_thumbnail: false
    };
    var QUALITY_ROWS = [
      ["best", "Best available", "Highest quality video + audio"],
      ["1080", "1080p", "Full HD or best below it"],
      ["720", "720p", "HD or best below it"],
      ["480", "480p", "Smaller file"],
      ["worst", "Smallest file", "Lowest available quality"]
    ];
    var MODE_ROWS = [
      ["video", "Video", "MP4 / MKV with audio"],
      ["audio", "Audio", "MP3 only"],
      ["songs", "Songs", "MP3 + music metadata"]
    ];

    var overlay = document.createElement("div");
    overlay.className = "yood-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:14px Roboto,Arial,sans-serif;";
    var card = document.createElement("section");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.style.cssText = "width:min(480px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 40px));overflow:auto;background:" + YT_BG + ";color:" + YT_TEXT + ";border-radius:12px;box-shadow:0 8px 40px #000c;padding:8px 0 0;";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;padding:12px 8px 8px 20px;";
    var title = document.createElement("div");
    title.style.cssText = "flex:1;font-size:16px;font-weight:500;";
    try { title.textContent = yoodT("download"); } catch (e) { title.textContent = "Download"; }
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "\u2715";
    x.setAttribute("aria-label", "Close");
    x.style.cssText = "width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:" + YT_TEXT + ";font-size:18px;cursor:pointer;";
    head.appendChild(title);
    head.appendChild(x);
    card.appendChild(head);
    var videoName = document.createElement("div");
    videoName.style.cssText = "font-size:12px;color:" + YT_MUTED + ";padding:0 20px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    videoName.textContent = document.title.replace(/ - YouTube$/, "");
    card.appendChild(videoName);

    function refresh() {
      var audioOnly = state.mode !== "video";
      card.querySelectorAll("[data-yood-q]").forEach(function (row) {
        var on = row.getAttribute("data-yood-q") === state.quality && !audioOnly;
        row.setAttribute("aria-selected", on ? "true" : "false");
        row.style.opacity = audioOnly ? ".45" : "1";
        var radio = row.firstChild;
        radio.style.borderColor = on ? YT_BLUE : "#909090";
        radio.innerHTML = on ? '<span style="width:10px;height:10px;border-radius:50%;background:' + YT_BLUE + ';"></span>' : "";
      });
      card.querySelectorAll("[data-yood-m]").forEach(function (row) {
        var on = row.getAttribute("data-yood-m") === state.mode;
        row.setAttribute("aria-selected", on ? "true" : "false");
        var radio = row.firstChild;
        radio.style.borderColor = on ? YT_BLUE : "#909090";
        radio.innerHTML = on ? '<span style="width:10px;height:10px;border-radius:50%;background:' + YT_BLUE + ';"></span>' : "";
      });
      var contRow = card.querySelector("[data-yood-cont]");
      if (contRow) {
        contRow.style.opacity = audioOnly ? ".45" : "1";
        var sel = contRow.querySelector("select");
        if (sel) { sel.disabled = audioOnly; sel.value = state.container; }
      }
      var subRow = card.querySelector("[data-yood-sub]");
      if (subRow) {
        var on = state.subtitles;
        subRow.setAttribute("aria-selected", on ? "true" : "false");
        var radio = subRow.firstChild;
        radio.style.borderColor = on ? YT_BLUE : "#909090";
        radio.innerHTML = on ? '<span style="width:10px;height:10px;border-radius:50%;background:' + YT_BLUE + ';"></span>' : "";
      }
      var langRow = card.querySelector("[data-yood-lang]");
      if (langRow) {
        langRow.style.opacity = state.subtitles ? "1" : ".45";
        var langSel = langRow.querySelector("select");
        if (langSel) { langSel.disabled = !state.subtitles; langSel.value = state.subtitle_lang; }
      }
    }

    card.appendChild(ytSectionHeader("Format"));
    MODE_ROWS.forEach(function (item) {
      var row = ytRow(item[1], item[2], state.mode === item[0], false);
      row.setAttribute("data-yood-m", item[0]);
      row.addEventListener("click", function () { state.mode = item[0]; refresh(); });
      card.appendChild(row);
    });

    card.appendChild(ytSectionHeader("Quality"));
    QUALITY_ROWS.forEach(function (item) {
      var row = ytRow(item[1], item[2], state.quality === item[0], false);
      row.setAttribute("data-yood-q", item[0]);
      row.addEventListener("click", function () {
        if (state.mode !== "video") return;
        state.quality = item[0];
        refresh();
      });
      card.appendChild(row);
    });

    var contRow = document.createElement("div");
    contRow.setAttribute("data-yood-cont", "true");
    contRow.style.cssText = "display:flex;align-items:center;gap:14px;padding:11px 16px;";
    var contLabel = document.createElement("span");
    contLabel.style.cssText = "flex:1;font-size:14px;";
    contLabel.textContent = "Container";
    var contSel = document.createElement("select");
    contSel.style.cssText = "color:" + YT_TEXT + ";background:#303030;border:1px solid #666;border-radius:8px;padding:8px;";
    [["mp4", "MP4"], ["mkv", "MKV"]].forEach(function (pair) {
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      contSel.appendChild(opt);
    });
    contSel.value = state.container;
    contSel.addEventListener("change", function () { state.container = contSel.value; });
    contRow.appendChild(contLabel);
    contRow.appendChild(contSel);
    card.appendChild(ytSectionHeader("File"));
    card.appendChild(contRow);
    var folderRow = document.createElement("div");
    folderRow.style.cssText = "display:flex;align-items:center;gap:10px;padding:11px 16px;";
    var folderLabel = document.createElement("span");
    folderLabel.style.cssText = "flex:none;font-size:14px;";
    try { folderLabel.textContent = yoodT("saveToFolder"); } catch (e) { folderLabel.textContent = "Save to"; }
    var folderInput = document.createElement("input");
    folderInput.type = "text";
    try { folderInput.setAttribute("aria-label", yoodT("saveToFolder")); } catch (e) { folderInput.setAttribute("aria-label", "Download folder"); }
    try { folderInput.placeholder = yoodT("defaultFolder"); } catch (e) { folderInput.placeholder = "Default folder"; }
    folderInput.spellcheck = false;
    folderInput.style.cssText = "flex:1;min-width:0;color:" + YT_TEXT + ";background:#303030;border:1px solid #666;border-radius:8px;padding:8px;";
    loadDefaultFolder(folderInput);
    var browseBtn = document.createElement("button");
    browseBtn.type = "button";
    try { browseBtn.textContent = yoodT("browse"); } catch (e) { browseBtn.textContent = "Browse…"; }
    try { browseBtn.setAttribute("aria-label", yoodT("browse")); } catch (e) { }
    browseBtn.style.cssText = "flex:none;border:1px solid #666;border-radius:8px;padding:8px 12px;color:" + YT_TEXT + ";background:#303030;font-size:13px;cursor:pointer;white-space:nowrap;";
    browseBtn.addEventListener("click", function () {
      browseBtn.disabled = true;
      var prev = "";
      try { prev = browseBtn.textContent; browseBtn.textContent = "…"; } catch (e) { }
      yoodDlPickFolder(function (picked) {
        browseBtn.disabled = false;
        try { browseBtn.textContent = prev; } catch (e) { }
        if (picked) {
          try { folderInput.value = picked; } catch (e) { }
          try { localStorage.setItem("yood-download-folder", picked); } catch (e2) { }
        } else {
          try { laterToast(yoodT("browseFailed")); } catch (e3) { }
        }
      });
    });
    folderRow.appendChild(folderLabel);
    folderRow.appendChild(folderInput);
    folderRow.appendChild(browseBtn);
    card.appendChild(folderRow);

    card.appendChild(ytSectionHeader("Subtitles"));
    var subRow = ytRow("Download subtitles", "Manual captions when available", false, false);
    subRow.setAttribute("data-yood-sub", "true");
    subRow.addEventListener("click", function () { state.subtitles = !state.subtitles; refresh(); });
    card.appendChild(subRow);
    var langRow = document.createElement("div");
    langRow.setAttribute("data-yood-lang", "true");
    langRow.style.cssText = "display:flex;align-items:center;gap:14px;padding:11px 16px;";
    var langLabel = document.createElement("span");
    langLabel.style.cssText = "flex:1;";
    var langTitle = document.createElement("div");
    langTitle.style.cssText = "font-size:14px;";
    langTitle.textContent = "Language";
    var langSub = document.createElement("div");
    langSub.style.cssText = "font-size:12px;color:" + YT_MUTED + ";margin-top:2px;";
    langSub.textContent = "Auto-translated when manual captions are missing";
    langLabel.appendChild(langTitle);
    langLabel.appendChild(langSub);
    var langSel = document.createElement("select");
    langSel.style.cssText = "color:" + YT_TEXT + ";background:#303030;border:1px solid #666;border-radius:8px;padding:8px;max-width:55%;";
    SUBTITLE_LANGS.forEach(function (pair) {
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      langSel.appendChild(opt);
    });
    langSel.value = state.subtitle_lang;
    langSel.addEventListener("change", function () {
      state.subtitle_lang = langSel.value;
      storeSubLang(langSel.value);
    });
    langRow.appendChild(langLabel);
    langRow.appendChild(langSel);
    card.appendChild(langRow);

    var advanced = document.createElement("details");
    advanced.style.cssText = "margin:4px 16px 0;";
    var summary = document.createElement("summary");
    summary.textContent = "Advanced";
    summary.style.cssText = "cursor:pointer;padding:8px 0;color:" + YT_MUTED + ";";
    advanced.appendChild(summary);
    var formatInput = document.createElement("input");
    formatInput.type = "text";
    formatInput.placeholder = "yt-dlp format selector (optional)";
    formatInput.style.cssText = "width:100%;box-sizing:border-box;color:" + YT_TEXT + ";background:#303030;border:1px solid #666;border-radius:8px;padding:10px;margin:4px 0 10px;";
    formatInput.addEventListener("input", function () { state.format_selector = formatInput.value.trim(); });
    var thumbRow = ytRow("Embed thumbnail and metadata", "", false, false);
    thumbRow.addEventListener("click", function () {
      state.embed_thumbnail = !state.embed_thumbnail;
      var on = state.embed_thumbnail;
      thumbRow.setAttribute("aria-selected", on ? "true" : "false");
      var radio = thumbRow.firstChild;
      radio.style.borderColor = on ? YT_BLUE : "#909090";
      radio.innerHTML = on ? '<span style="width:10px;height:10px;border-radius:50%;background:' + YT_BLUE + ';"></span>' : "";
    });
    advanced.appendChild(formatInput);
    advanced.appendChild(thumbRow);
    card.appendChild(advanced);

    var foot = document.createElement("div");
    foot.style.cssText = "display:flex;justify-content:flex-end;gap:4px;padding:8px 12px 12px;";
    var cancel = document.createElement("button");
    cancel.type = "button";
    try { cancel.textContent = yoodT("cancel"); } catch (e) { cancel.textContent = "Cancel"; }
    cancel.style.cssText = "border:0;border-radius:18px;padding:10px 16px;color:" + YT_BLUE + ";background:transparent;font-size:14px;font-weight:500;cursor:pointer;";
    cancel.addEventListener("click", closeDialog);
    var start = document.createElement("button");
    start.type = "button";
    try { start.textContent = yoodT("download"); } catch (e) { start.textContent = "Download"; }
    start.style.cssText = "border:0;border-radius:18px;padding:10px 16px;color:#fff;background:" + YT_PRIMARY + ";font-size:14px;font-weight:500;cursor:pointer;";
    start.addEventListener("click", function () {
      start.disabled = true;
      try {
        var folder = "";
        try { folder = folderInput.value.trim(); } catch (e) { folder = ""; }
        if (folder) {
          try { localStorage.setItem("yood-download-folder", folder); } catch (e) { /* private mode */ }
        }
        yoodSendDownload(pageUrl, {
          mode: state.mode,
          quality: state.quality,
          container: state.container,
          format_selector: state.format_selector || undefined,
          subtitles: state.subtitles,
          subtitle_lang: state.subtitles ? state.subtitle_lang : undefined,
          embed_thumbnail: state.embed_thumbnail || state.mode === "songs",
          directory: folder || undefined
        });
      } finally {
        closeDialog();
      }
    });
    foot.appendChild(cancel);
    foot.appendChild(start);
    try {
      if (/[?&]list=/i.test(pageUrl)) {
        var plUrls = yoodPlaylistUrlsFromDom(200);
        if (plUrls.length > 1) {
          var plBtn = document.createElement("button");
          plBtn.type = "button";
          try { plBtn.textContent = "\u2913 " + yoodT("playlistTitle") + " (" + plUrls.length + ")"; }
          catch (e) { plBtn.textContent = "Download entire playlist (" + plUrls.length + ")"; }
          plBtn.style.cssText = "display:block;width:calc(100% - 24px);margin:0 12px 4px;border:1px solid #3ea6ff;border-radius:18px;padding:10px 16px;color:#3ea6ff;background:transparent;font-size:14px;font-weight:500;cursor:pointer;";
          plBtn.addEventListener("click", function () {
            closeDialog();
            document.removeEventListener("keydown", onKey);
            showPlaylistConfirm(yoodPlaylistUrlsFromDom(200));
          });
          card.appendChild(plBtn);
        }
      }
    } catch (e) { /* single-video dialog stays as-is */ }
    card.appendChild(foot);

    overlay.appendChild(card);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeDialog();
    });
    var onKey = function (event) {
      if (event.key === "Escape") {
        closeDialog();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    x.addEventListener("click", function () {
      closeDialog();
      document.removeEventListener("keydown", onKey);
    });
    try { yoodDialogParent().appendChild(overlay); }
    catch (e) { try { document.body.appendChild(overlay); } catch (e2) { } }
    refresh();
  }

  // ---- In-player ad skip (backup for video ads Shields may miss) ----
  // Video ads stream from the same CDN as real content, so no URL blocker
  // can stop them. When one still plays, mute it, speed it up, jump past
  // unskippable bumpers and press Skip the moment YouTube enables it.
  // Runs ONLY while the player itself reports an ad with ad UI present —
  // normal playback is never touched, and nothing polls while idle.
  var yoodSkipTimer;
  var yoodMutedForAd = false;
  var yoodRateForAd = false;

  function yoodPlayerRoots() {
    var roots = [];
    try {
      var main = document.getElementById("movie_player");
      if (main && main.isConnected && roots.indexOf(main) === -1) roots.push(main);
    } catch (e) { /* noop */ }
    try {
      // Shorts: each reel is its own player; only the active one can show an ad.
      var reels = document.querySelectorAll("ytd-reel-video-renderer[is-active], ytd-shorts ytd-reel-video-renderer");
      for (var i = 0; i < reels.length && roots.length < 4; i++) {
        if (reels[i] instanceof Element && reels[i].isConnected && roots.indexOf(reels[i]) === -1) {
          roots.push(reels[i]);
        }
      }
    } catch (e) { /* noop */ }
    return roots;
  }
  function yoodIsAd(node) {
    try {
      return node.classList.contains("ad-showing") || node.classList.contains("ad-interrupting");
    } catch (e) { return false; }
  }
  function yoodStopTimer() {
    if (yoodSkipTimer !== undefined) {
      clearInterval(yoodSkipTimer);
      yoodSkipTimer = undefined;
    }
  }
  function yoodRestore(node) {
    var video = null;
    try { video = node.querySelector("video.html5-main-video, video"); } catch (e) { video = null; }
    if (!video) return;
    try {
      if (yoodMutedForAd) { video.muted = false; yoodMutedForAd = false; }
      if (yoodRateForAd) { video.playbackRate = 1; yoodRateForAd = false; }
    } catch (e) { /* ad is gone anyway */ }
  }
  function yoodRestoreAll() {
    var roots = yoodPlayerRoots();
    for (var i = 0; i < roots.length; i++) yoodRestore(roots[i]);
  }
  function yoodAdFrame() {
    var roots = yoodPlayerRoots();
    if (!roots.length) { yoodStopTimer(); return; }
    var anyAd = false;
    for (var i = 0; i < roots.length; i++) {
      var node = roots[i];
      if (!yoodIsAd(node)) {
        yoodRestore(node);
        continue;
      }
      anyAd = true;
      var skip = null;
      var overlay = null;
      try {
        skip = node.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-skip-ad-button-modern, .ytp-ad-skip-button-modern");
        overlay = node.querySelector(".ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-message-container, .ytp-ad-skip-button-container, .ytp-ad-player-overlay-layout");
      } catch (e) { skip = null; overlay = null; }
      if (!skip && !overlay) continue;
      var video = null;
      try { video = node.querySelector("video.html5-main-video, video"); } catch (e) { video = null; }
      if (video) {
        try {
          if (!video.muted) { video.muted = true; yoodMutedForAd = true; }
          if (video.playbackRate !== 16) { video.playbackRate = 16; yoodRateForAd = true; }
          if (isFinite(video.duration) && video.duration > 0 && video.duration <= 120 &&
            video.currentTime < video.duration - 0.3) {
            video.currentTime = video.duration - 0.1;
          }
        } catch (e) { /* next tick retries */ }
      }
      if (skip && skip.offsetParent !== null) {
        try { skip.click(); } catch (e) { /* next tick */ }
      }
    }
    if (!anyAd) {
      yoodStopTimer();
      yoodRestoreAll();
    }
  }
  function yoodAdClassChanged() {
    var roots = yoodPlayerRoots();
    var found = false;
    for (var i = 0; i < roots.length; i++) {
      if (yoodIsAd(roots[i])) { found = true; break; }
    }
    if (found) {
      yoodAdFrame();
      if (yoodSkipTimer === undefined) yoodSkipTimer = setInterval(yoodAdFrame, 400);
    } else {
      yoodStopTimer();
      yoodRestoreAll();
    }
  }
  function yoodWatchNode(node) {
    if (!node || node.hasAttribute("data-yood-adwatch")) return false;
    try {
      node.setAttribute("data-yood-adwatch", "");
      new MutationObserver(yoodAdClassChanged).observe(node, { attributes: true, attributeFilter: ["class"] });
      return true;
    } catch (e) { return false; }
  }
  function installPlayerAdSkip() {
    var roots = yoodPlayerRoots();
    if (!roots.length) return;
    for (var i = 0; i < roots.length; i++) yoodWatchNode(roots[i]);
    yoodAdClassChanged();
  }

  // ---- Yood "Watch later" (an injected queue, not YouTube's own) ----
  // Saved videos persist per origin in localStorage; the bottom-right pill
  // ("Watch later") opens the queue, and open one entry to jump to it — like
  // switching between soft tabs, without browser tabs.
  var WL_KEY = "yood-watch-later";
  var WL_MAX_ITEMS = 200;
  var WL_MAX_JSON_BYTES = 1024 * 1024;
  function wlRead() {
    try {
      var raw = localStorage.getItem(WL_KEY) || "[]";
      if (raw.length > WL_MAX_JSON_BYTES) { localStorage.removeItem(WL_KEY); return []; }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (item) {
        return !!item && typeof item === "object" &&
          typeof item.id === "string" && item.id.length <= 128 &&
          typeof item.url === "string" && item.url.length <= 2048;
      }).slice(0, WL_MAX_ITEMS);
    } catch (e) { return []; }
  }
  function wlWrite(items) {
    try { localStorage.setItem(WL_KEY, JSON.stringify(items.slice(0, WL_MAX_ITEMS))); } catch (e) { /* private mode */ }
  }
  function wlId(url) {
    try {
      var parsed = new URL(url, location.href);
      return parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || url;
    } catch (e) { return url; }
  }
  function wlThumb(id) {
    if (!id || /[^A-Za-z0-9_-]/.test(id) || id.length > 32) return "";
    return "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg";
  }
  function wlFind(url) {
    var id = wlId(url), items = wlRead();
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function wlCurrent(url) {
    var existing = wlFind(url);
    if (existing) return existing;
    var channel = null;
    try {
      channel = document.querySelector("ytd-watch-metadata #owner ytd-channel-name a#text, #channel-name a, ytd-channel-name a, .ytd-channel-name a");
    } catch (e) { channel = null; }
    return {
      id: wlId(url),
      url: url,
      title: (document.title.replace(/ - YouTube$/, "") || "Untitled").trim(),
      channel: channel ? channel.textContent.trim() : "",
      thumb: wlThumb(wlId(url)),
      addedAt: Date.now()
    };
  }
  function wlToggle(url) {
    var items = wlRead(), id = wlId(url), idx = -1, i;
    for (i = 0; i < items.length; i++) if (items[i].id === id) { idx = i; break; }
    if (idx === -1) { items.unshift(wlCurrent(url)); wlWrite(items); wlRefreshUI(); return true; }
    items.splice(idx, 1); wlWrite(items); wlRefreshUI(); return false;
  }
  function wlRemove(id) {
    var items = wlRead(), next = [], i;
    for (i = 0; i < items.length; i++) if (items[i].id !== id) next.push(items[i]);
    wlWrite(next); wlRefreshUI();
  }
  function wlClear() { wlWrite([]); wlRefreshUI(); }
  // Drops and plain link pastes carry no title ("Untitled"). Resolve those
  // lazily through YouTube's oEmbed endpoint (no key needed) the first time
  // the panel opens, then persist the result with the entry.
  var wlTitleTried = {};
  function wlResolveTitles(panel) {
    if (!panel || panel.style.display === "none") return;
    var items = wlRead(), pending = [], i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if ((!it.title || it.title === "Untitled") && !wlTitleTried[it.id]) {
        if (Object.keys(wlTitleTried).length >= 500) {
          var firstTried = Object.keys(wlTitleTried)[0];
          delete wlTitleTried[firstTried];
        }
        wlTitleTried[it.id] = true;
        pending.push(it);
      }
      if (pending.length >= 5) break;
    }
    pending.forEach(function (it) {
      try {
        fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent(it.url) + "&format=json")
          .then(function (response) { if (!response.ok) throw 0; return response.json(); })
          .then(function (data) {
            if (!data || typeof data.title !== "string" || !data.title) return;
            var all = wlRead(), k;
            for (k = 0; k < all.length; k++) {
              if (all[k].id === it.id) {
                all[k].title = data.title;
                if (typeof data.author_name === "string" && data.author_name) all[k].channel = data.author_name;
                break;
              }
            }
            wlWrite(all);
            var open = document.getElementById("yood-later-panel");
            if (open && open.style.display !== "none") wlRenderPanel(open);
          })
          .catch(function () { /* stays Untitled */ });
      } catch (e) { /* offline */ }
    });
  }
  function wlStyleChip(chip, saved) {
    chip.style.cssText = (saved
      ? "border:0;background:#168aca;color:#fff;"
      : "border:1px solid #5f5f5f;background:#1f1f1f;color:#e8e8e8;") +
      "border-radius:18px;padding:8px 14px;margin:4px;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;";
  }
  function wlRefreshChip(chip) {
    var saved = !!wlFind(chip.getAttribute(MARK_LATER));
    try { chip.textContent = saved ? yoodT("saved") : yoodT("watchLater"); } catch (e) { chip.textContent = saved ? "\u2713 Saved" : "Watch later"; }
    wlStyleChip(chip, saved);
    chip.setAttribute("aria-pressed", String(saved));
  }
  function wlDownloadAll() {
    var items = wlRead();
    if (!items.length) return;
    try { laterToast(yoodT("sent") + " (" + items.length + ")"); } catch (e) { }
    for (var k = 0; k < items.length; k++) {
      (function (u, idx) {
        setTimeout(function () { try { yoodSendDownload(u, { mode: "video" }, null); } catch (e) { } }, idx * 600);
      })(items[k].url, k);
    }
  }
  function wlRefreshUI() {
    var items = wlRead();
    try {
      var pillLabel = document.querySelector("#yood-later-pill span:first-child");
      if (pillLabel) pillLabel.textContent = yoodT("watchLater");
      var headNode = document.querySelector("#yood-later-panel .yood-later-head-label");
      if (headNode) headNode.textContent = yoodT("watchLater");
      var clearBtn = document.querySelector("#yood-later-panel [data-yood-clear]");
      if (clearBtn) clearBtn.textContent = yoodT("clear");
      var allBtn = document.querySelector("#yood-later-panel [data-yood-download-all]");
      if (allBtn) allBtn.textContent = yoodT("downloadAll");
    } catch (e) { }
    var badge = document.querySelector("#yood-later-pill .yood-later-count");
    if (badge) {
      badge.style.display = items.length ? "inline-flex" : "none";
      badge.textContent = items.length > 99 ? "99+" : String(items.length);
    }
    var chips = document.querySelectorAll("[" + MARK_LATER + "]");
    for (var i = 0; i < chips.length; i++) wlRefreshChip(chips[i]);
    var panel = document.getElementById("yood-later-panel");
    if (panel && panel.style.display !== "none") wlRenderPanel(panel);
  }
  function wlRenderPanel(panel) {
    var list = document.getElementById("yood-later-list");
    if (!list) return;
    list.textContent = "";
    var items = wlRead();
    if (!items.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "padding:18px 14px;color:#aaa;text-align:center;";
      try { empty.textContent = yoodT("empty"); } catch (e) { empty.textContent = "No videos saved yet"; }
      list.appendChild(empty);
      return;
    }
    wlResolveTitles(panel);
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = document.createElement("div");
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.style.cssText = "display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-top:1px solid #2b2b2b;cursor:pointer;";
        row.onmouseenter = function () { row.style.background = "#242424"; };
        row.onmouseleave = function () { row.style.background = "transparent"; };
        var thumbUrl = item.thumb || wlThumb(item.id);
        if (thumbUrl) {
          var thumb = document.createElement("img");
          thumb.src = thumbUrl;
          thumb.alt = "";
          thumb.loading = "lazy";
          thumb.style.cssText = "flex:none;width:96px;height:54px;object-fit:cover;border-radius:8px;background:#000;";
          thumb.addEventListener("error", function () { try { thumb.remove(); } catch (e) { /* text-only row */ } });
          row.appendChild(thumb);
        }
        var text = document.createElement("div");
        text.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;";
        var title = document.createElement("span");
        title.title = item.title || "Untitled";
        title.style.cssText = "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;";
        title.textContent = item.title || "Untitled";
        text.appendChild(title);
        if (item.channel) {
          var chan = document.createElement("span");
          chan.style.cssText = "font-size:12px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          chan.textContent = item.channel;
          text.appendChild(chan);
        }
        var remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "\u2715";
        remove.setAttribute("aria-label", "Remove from Watch later");
        remove.style.cssText = "flex:none;width:26px;height:26px;border:0;border-radius:50%;color:#bbb;background:transparent;cursor:pointer;font-size:13px;line-height:1;";
        remove.onmouseenter = function () { remove.style.background = "#3a3a3a"; remove.style.color = "#fff"; };
        remove.onmouseleave = function () { remove.style.background = "transparent"; remove.style.color = "#bbb"; };
        remove.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          wlRemove(item.id);
          wlRenderPanel(panel);
        });
        var navigate = function () {
          panel.style.display = "none";
          // Opening a saved video consumes it: it leaves Watch later.
          try { wlRemove(item.id); } catch (e) { /* already gone */ }
          if (item.url !== location.href) location.href = item.url;
        };
        row.appendChild(text);
        row.appendChild(remove);
        row.addEventListener("click", navigate);
        row.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(); }
        });
        list.appendChild(row);
      })(items[i]);
    }
  }
  function ensureLaterPanel() {
    var existing = document.getElementById("yood-later-panel");
    if (existing) return existing;
    if (!document.body) return null;
    var panel = document.createElement("div");
    panel.id = "yood-later-panel";
    panel.style.cssText = "position:fixed;right:18px;bottom:68px;z-index:2147483642;width:min(340px,calc(100vw - 32px));max-height:min(420px,calc(100vh - 120px));overflow:auto;background:#181818f5;color:#f1f1f1;border:1px solid #444;border-radius:14px;box-shadow:0 12px 40px #000a;font:13px Roboto,Arial,sans-serif;display:none;";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px;padding:12px 8px 8px 14px;font-weight:600;";
    var headLabel = document.createElement("span");
    headLabel.className = "yood-later-head-label";
    try { headLabel.textContent = yoodT("watchLater"); } catch (e) { headLabel.textContent = "Watch later"; }
    head.appendChild(headLabel);
    var all = document.createElement("button");
    all.type = "button";
    try { all.textContent = yoodT("downloadAll"); } catch (e) { all.textContent = "Download all"; }
    all.setAttribute("data-yood-download-all", "true");
    all.style.cssText = "margin-left:auto;flex:none;border:1px solid #3ea6ff;border-radius:14px;padding:4px 10px;color:#3ea6ff;background:transparent;cursor:pointer;font-size:12px;";
    all.addEventListener("click", function (event) {
      event.stopPropagation();
      wlDownloadAll();
    });
    head.appendChild(all);
    var clear = document.createElement("button");
    clear.type = "button";
    try { clear.textContent = yoodT("clear"); } catch (e) { clear.textContent = "Clear"; }
    clear.setAttribute("data-yood-clear", "true");
    clear.style.cssText = "flex:none;border:1px solid #555;border-radius:14px;padding:4px 10px;color:inherit;background:transparent;cursor:pointer;font-size:12px;";
    clear.addEventListener("click", function (event) {
      event.stopPropagation();
      wlClear();
      wlRenderPanel(panel);
    });
    head.appendChild(clear);
    var list = document.createElement("div");
    list.id = "yood-later-list";
    panel.appendChild(head);
    panel.appendChild(list);
    document.body.appendChild(panel);
    wlRenderPanel(panel);
    return panel;
  }
  // Back/forward cluster: Brave app mode shows no browser chrome, so
  // Yood adds its own previous/next-page buttons (bottom-left).
  function ensureYoodNav() {
    if (!document.body) return;
    var nav = document.getElementById("yood-nav");
    var rtl = false;
    try {
      var dir = (document.documentElement.getAttribute("dir") || document.body.getAttribute("dir") || "").toLowerCase();
      if (!dir) { try { dir = getComputedStyle(document.body).direction || ""; } catch (e) { dir = ""; } }
      rtl = dir.indexOf("rtl") !== -1;
    } catch (e) { rtl = false; }
    var backArrow = rtl ? "\u2192" : "\u2190";
    var fwdArrow = rtl ? "\u2190" : "\u2192";
    if (!nav) {
      nav = document.createElement("div");
      nav.id = "yood-nav";
      nav.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483640;display:flex;gap:6px;";
      var back = document.createElement("button");
      back.type = "button";
      back.setAttribute("data-yood-nav", "back");
      back.textContent = backArrow;
      back.style.cssText = "width:40px;height:40px;border:1px solid #444;border-radius:50%;color:#f1f1f1;background:#181818e8;box-shadow:0 4px 16px #0008;cursor:pointer;font-size:18px;";
      back.addEventListener("click", function () { try { window.history.back(); } catch (e) { } });
      var fwd = document.createElement("button");
      fwd.type = "button";
      fwd.setAttribute("data-yood-nav", "fwd");
      fwd.textContent = fwdArrow;
      fwd.style.cssText = back.style.cssText;
      fwd.addEventListener("click", function () { try { window.history.forward(); } catch (e) { } });
      nav.appendChild(back);
      nav.appendChild(fwd);
      document.body.appendChild(nav);
    }
    try {
      var bb = nav.querySelector('[data-yood-nav="back"]');
      var fb = nav.querySelector('[data-yood-nav="fwd"]');
      if (bb) { bb.textContent = backArrow; bb.setAttribute("aria-label", yoodT("back")); bb.title = yoodT("back"); }
      if (fb) { fb.textContent = fwdArrow; fb.setAttribute("aria-label", yoodT("forward")); fb.title = yoodT("forward"); }
    } catch (e) { /* labels stay */ }
  }
  function toggleLaterPanel() {
    var panel = ensureLaterPanel();
    if (!panel) return;
    var show = panel.style.display === "none";
    panel.style.display = show ? "block" : "none";
    if (show) wlRenderPanel(panel);
  }
  function ensureLaterPill() {
    var existing = document.getElementById("yood-later-pill");
    if (existing) return;
    if (!document.body) return;
    var pill = document.createElement("button");
    pill.id = "yood-later-pill";
    pill.type = "button";
    pill.title = "Yood Watch later — drag videos here or click to open";
    try { pill.setAttribute("aria-label", yoodT("watchLater")); } catch (e) { pill.setAttribute("aria-label", "Watch later list"); }
    pill.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483641;display:inline-flex;align-items:center;gap:7px;border:0;border-radius:22px;height:40px;padding:0 16px;color:#fff;background:#065fd4;box-shadow:0 4px 16px #0008;cursor:pointer;font:500 14px Roboto,Arial,sans-serif;";
    var label = document.createElement("span");
    try { label.textContent = yoodT("watchLater"); } catch (e) { label.textContent = "Watch later"; }
    var badge = document.createElement("span");
    badge.className = "yood-later-count";
    badge.style.cssText = "display:none;min-width:18px;height:18px;line-height:18px;padding:0 5px;border-radius:9px;background:#f00;color:#fff;font-size:11px;font-weight:700;text-align:center;box-sizing:border-box;";
    pill.appendChild(label);
    pill.appendChild(badge);
    pill.addEventListener("click", toggleLaterPanel);
    document.body.appendChild(pill);
    wlRefreshUI();
  }
  // ---- Downloads side panel (live progress, inside the page) ----
  // The extension has no Tauri bridge, so progress comes from the
  // backend's localhost feed (port published per launch in defaults.json).
  // Native folder picker through the backend's localhost server
  // (authenticated POST /pick-folder opens the OS dialog; the extension page itself has
  // no way to show one). Resolves with the chosen path or null.
  function yoodDlPickFolder(done) {
    yoodDlEnsureBase(function (base) {
      if (!base) { done(null); return; }
      yoodLocalFetch(base + "/pick-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
        .then(function (response) { if (!response.ok) throw 0; return response.json(); })
        .then(function (data) {
          done(data && typeof data.path === "string" && data.path ? data.path : null);
        })
        .catch(function () { done(null); });
    });
  }
  var yoodDlBase = null;
  var yoodDlTried = false;
  function yoodLocalFetch(url, options) {
    options = options || {};
    var parsed;
    try { parsed = new URL(url); }
    catch (e) { return Promise.reject(new Error("invalid Yood local API URL")); }
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" ||
        !["/downloads", "/enqueue", "/pick-folder"].includes(parsed.pathname)) {
      return Promise.reject(new Error("unsupported Yood local API URL"));
    }
    var runtime = (typeof browser !== "undefined" && browser.runtime)
      ? browser
      : (typeof chrome !== "undefined" ? chrome : null);
    if (!runtime) return Promise.reject(new Error("extension runtime unavailable"));
    return new Promise(function (resolve, reject) {
      runtime.runtime.sendMessage({
        type: "yood-local-request",
        path: parsed.pathname,
        method: String(options.method || "GET").toUpperCase(),
        body: options.body
      }, function (response) {
        var error = runtime.runtime.lastError;
        if (error) { reject(new Error(error.message || "Yood local API request failed")); return; }
        if (!response || response.error) {
          reject(new Error(response && response.error ? response.error : "Yood local API request failed"));
          return;
        }
        resolve({
          ok: response.ok === true,
          status: response.status,
          json: function () { return Promise.resolve(response.body); }
        });
      });
    });
  }
  function yoodDlEnsureBase(done) {
    if (yoodDlBase) { done(yoodDlBase); return; }
    if (yoodDlTried) { done(null); return; }
    yoodDlTried = true;
    // A failed first attempt (backend still starting) retries soon
    // instead of staying dead until reload.
    setTimeout(function () { yoodDlTried = false; }, 10000);
    yoodReadDefaults()
      .then(function (data) {
        if (data && typeof data.progress_port === "number" && data.progress_port > 0) {
          yoodDlBase = "http://127.0.0.1:" + data.progress_port;
        }
        done(yoodDlBase);
      })
      .catch(function () { done(null); });
  }
  function yoodDlActive(items) {
    var count = 0;
    for (var i = 0; i < items.length; i++) {
      var status = items[i].status;
      if (status === "downloading" || status === "paused" || status === "queued" || status === "interrupted") count++;
    }
    return count;
  }
  var yoodDlLastItems = [];
  var yoodDlTimer = null;
  var yoodDlPrevStatus = {};
  var yoodDlToastTimer = null;
  var yoodDlStartedAt = Date.now();
  var YOOD_DL_ACTIVE_STATUSES = ["downloading", "paused", "queued", "interrupted"];
  function yoodDlStatusLabel(status) {
    if (status === "completed") return yoodT("statusCompleted");
    return status;
  }
  function yoodDlToast(ok, message) {
    try {
      var old = document.getElementById("yood-dl-toast");
      if (old) old.remove();
    } catch (e) { /* ignore */ }
    if (yoodDlToastTimer !== null) { try { clearTimeout(yoodDlToastTimer); } catch (e) { /* ignore */ } yoodDlToastTimer = null; }
    var node = document.createElement("div");
    node.id = "yood-dl-toast";
    node.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:min(360px,calc(100vw - 32px));background:#292929;color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 4px 18px #000a;font:13px Roboto,Arial,sans-serif;border-left:4px solid " + (ok ? "#2ecc71" : "#e53935") + ";display:flex;gap:8px;align-items:center;";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    var icon = document.createElement("span");
    icon.style.cssText = "flex:none;font-weight:700;";
    icon.textContent = ok ? "✔" : "✕";
    var text = document.createElement("span");
    text.textContent = message;
    node.appendChild(icon);
    node.appendChild(text);
    try { document.body.appendChild(node); } catch (e) { return; }
    yoodDlToastTimer = setTimeout(function () { yoodDlToastTimer = null; try { node.remove(); } catch (e) { /* ignore */ } }, 6000);
  }
  function yoodDlNotifyEnded(items) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      if (typeof item.id !== "string" || !item.id) continue;
      var status = item.status;
      var prev = yoodDlPrevStatus[item.id];
      yoodDlPrevStatus[item.id] = status;
      if (status !== "completed" && status !== "failed") continue;
      if (prev === status) continue;
      var completedAt = Date.parse(item.completed_at || "");
      var completedSincePageLoad = status === "completed" &&
        Number.isFinite(completedAt) && completedAt >= yoodDlStartedAt - 2000;
      if (YOOD_DL_ACTIVE_STATUSES.indexOf(prev) === -1 && !completedSincePageLoad) continue;
      var title = (typeof item.title === "string" && item.title.trim()) ? item.title : "";
      yoodDlToast(status === "completed", (status === "completed" ? yoodT("downloadDone") : yoodT("downloadFailed")) + (title ? ": " + title : ""));
    }
  }
  function yoodDlSchedule(delay) {
    if (yoodDlTimer !== null) return;
    yoodDlTimer = setTimeout(function () {
      yoodDlTimer = null;
      yoodDlPoll();
    }, delay || (yoodDlActive(yoodDlLastItems) ? 1000 : 5000));
  }
  function yoodSafeImageUrl(value) {
    try {
      var url = new URL(String(value || ""));
      var host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return "";
      if (host === "i.ytimg.com" || host === "img.youtube.com" ||
        host === "yt3.ggpht.com" || host === "lh3.googleusercontent.com") {
        return url.href;
      }
    } catch (e) { /* invalid URL */ }
    return "";
  }
  function yoodDlRender(items) {
    yoodDlLastItems = Array.isArray(items) ? items : [];
    yoodDlNotifyEnded(yoodDlLastItems);
    var badge = document.querySelector("#yood-downloads-toggle .yood-dl-count");
    var active = yoodDlActive(items);
    if (badge) {
      badge.style.display = active ? "inline-flex" : "none";
      badge.textContent = active > 99 ? "99+" : String(active);
    }
    var panel = document.getElementById("yood-downloads-panel");
    if (!panel || panel.style.display === "none") {
      yoodDlSchedule(active ? 1500 : 5000);
      return;
    }
    var list = document.getElementById("yood-downloads-list");
    if (!list) {
      yoodDlSchedule(2000);
      return;
    }
    list.textContent = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "padding:18px 14px;color:#aaa;text-align:center;";
      empty.textContent = "No downloads yet";
      list.appendChild(empty);
      yoodDlSchedule(2000);
      return;
    }
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;gap:10px;align-items:center;padding:8px 8px 8px 14px;border-top:1px solid #2b2b2b;";
        var pct = Math.max(0, Math.min(100, Number(item.progress) || 0));
        var thumbnail = yoodSafeImageUrl(item.thumbnail);
        if (thumbnail) {
          var img = document.createElement("img");
          img.src = thumbnail;
          img.alt = "";
          img.loading = "lazy";
          img.style.cssText = "flex:none;width:96px;height:54px;object-fit:cover;border-radius:8px;background:#000;";
          img.addEventListener("error", function () { try { img.remove(); } catch (e) { /* text-only row */ } });
          row.appendChild(img);
        }
        var meta = document.createElement("div");
        meta.style.cssText = "flex:1;min-width:0;";
        var title = document.createElement("div");
        title.title = item.title || "";
        title.style.cssText = "font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;";
        title.textContent = item.title || "Download";
        meta.appendChild(title);
        var sub = document.createElement("div");
        sub.style.cssText = "font-size:12px;color:#aaa;margin-top:2px;";
        var bits = [yoodDlStatusLabel(item.status)];
        if (item.speed) bits.push(item.speed);
        if (item.eta) bits.push("ETA " + item.eta);
        if (item.error) bits.push(item.error);
        sub.textContent = bits.join(" · ");
        meta.appendChild(sub);
        var bar = document.createElement("div");
        bar.style.cssText = "height:5px;background:#444;border-radius:4px;overflow:hidden;margin-top:6px;";
        var fill = document.createElement("i");
        fill.style.cssText = "display:block;height:100%;background:#3ea6ff;transition:width .3s;width:" + pct + "%;";
        bar.appendChild(fill);
        meta.appendChild(bar);
        row.appendChild(meta);
        list.appendChild(row);
      })(items[i]);
    }
    var panelOpen = panel && panel.style.display !== "none";
    if (panelOpen || yoodDlActive(items)) yoodDlSchedule(panelOpen ? 1000 : 2000);
  }
  function yoodDlPoll() {
    if (document.hidden) return;
    yoodDlEnsureBase(function (base) {
      if (!base) return;
      yoodLocalFetch(base + "/downloads")
        .then(function (response) { if (!response.ok) throw 0; return response.json(); })
        .then(function (data) { yoodDlRender((data && data.items) || []); })
        .catch(function () {
          yoodDlBase = null;
          yoodDlTried = false;
          yoodDlSchedule(10000);
        });
    });
  }
  function ensureDownloadsPanel() {
    var existing = document.getElementById("yood-downloads-panel");
    if (existing) return existing;
    if (!document.body) return null;
    var panel = document.createElement("div");
    panel.id = "yood-downloads-panel";
    panel.style.cssText = "position:fixed;top:0;right:0;bottom:0;z-index:2147483642;width:min(380px,94vw);background:#181818f5;color:#f1f1f1;border-left:1px solid #444;box-shadow:-12px 0 40px #000a;font:13px Roboto,Arial,sans-serif;display:none;flex-direction:column;";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px;padding:14px 8px 10px 16px;font-weight:600;font-size:15px;";
    head.textContent = "Downloads";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close downloads");
    close.style.cssText = "margin-left:auto;flex:none;width:30px;height:30px;border:0;border-radius:50%;color:#eee;background:transparent;cursor:pointer;font-size:15px;";
    close.addEventListener("click", function () { panel.style.display = "none"; });
    head.appendChild(close);
    var list = document.createElement("div");
    list.id = "yood-downloads-list";
    list.style.cssText = "flex:1;overflow-y:auto;";
    panel.appendChild(head);
    panel.appendChild(list);
    document.body.appendChild(panel);
    return panel;
  }
  function toggleDownloadsPanel() {
    var panel = ensureDownloadsPanel();
    if (!panel) return;
    var show = panel.style.display === "none";
    panel.style.display = show ? "flex" : "none";
    if (show) yoodDlPoll();
  }
  function ensureDownloadsToggle() {
    if (document.getElementById("yood-downloads-toggle") || !document.body) return;
    var btn = document.createElement("button");
    btn.id = "yood-downloads-toggle";
    btn.type = "button";
    btn.title = "Yood Downloads — live progress";
    btn.setAttribute("aria-label", "Downloads with live progress");
    btn.style.cssText = "position:fixed;right:18px;bottom:66px;z-index:2147483641;width:40px;height:40px;border:0;border-radius:50%;color:#fff;background:#3a3a3a;box-shadow:0 4px 16px #0008;cursor:pointer;font:500 18px Roboto,Arial,sans-serif;";
    btn.textContent = "↓";
    var badge = document.createElement("span");
    badge.className = "yood-dl-count";
    badge.style.cssText = "display:none;position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;padding:0 5px;border-radius:9px;background:#f00;color:#fff;font-size:11px;font-weight:700;text-align:center;box-sizing:border-box;";
    btn.appendChild(badge);
    btn.addEventListener("click", toggleDownloadsPanel);
    document.body.appendChild(btn);
  }
  try {
    ensureDownloadsToggle();
    yoodDlPoll();
    yoodDlSchedule(5000);
  } catch (e) { /* never break the page */ }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) yoodDlPoll();
  });
  // Watch later lives ONLY inside the ⋮ overflow menu (injectMenuDownload)
  // and the bottom-right pill — never as an extra button in the action row.
  function laterToast(message) {
    var old = document.getElementById("yood-later-toast");
    if (old) old.remove();
    var node = document.createElement("div");
    node.id = "yood-later-toast";
    node.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:2147483647;background:#292929;color:#fff;padding:11px 16px;border-radius:6px;box-shadow:0 3px 12px #0008;font:13px Roboto,Arial,sans-serif;";
    node.textContent = message;
    try { yoodDialogParent().appendChild(node); }
    catch (e) { try { document.body.appendChild(node); } catch (e2) { } }
    setTimeout(function () { node.remove(); }, 4200);
  }
  // ---- Drag & drop into Watch later ----
  // Grab any video card and drop it on the Watch later pill, a Watch later
  // chip, or the open panel — no need to open the video first. Anchors are
  // natively draggable, so no `draggable` attributes are set (that would
  // disturb YouTube's own handlers); the drop side only accepts payloads
  // that parse as YouTube video URLs, everything else is left alone.
  var WL_MIME = "application/x-yood-video";
  var WL_DROP_SELECTOR = "#yood-later-pill,[data-yood-watch-later],#yood-later-panel";
  function wlCardTitle(card) {
    try {
      var nodes = card.querySelectorAll("#video-title, a#video-title, yt-formatted-string#video-title, .yt-lockup-metadata-view-model__title, [class*='lockup-metadata'][class*='title']");
      for (var i = 0; i < nodes.length; i++) {
        var t = ((nodes[i].getAttribute && nodes[i].getAttribute("aria-label")) || nodes[i].textContent || "").trim();
        if (t) return t;
      }
    } catch (e) { }
    try {
      var link = card.querySelector('a[href*="/watch"], a[href*="/shorts/"], a[href*="youtu.be/"]');
      var lt = link ? ((link.getAttribute("aria-label") || link.getAttribute("title") || "").trim()) : "";
      if (lt) return lt;
    } catch (e) { }
    return "";
  }
  function wlCardChannel(card) {
    try {
      var nodes = card.querySelectorAll("#channel-name a, ytd-channel-name a, .ytd-channel-name a, a[href*='/channel/'], a[href^='/@'], a[href*='youtube.com/@'], a[href*='youtube.com/channel/']");
      for (var i = 0; i < nodes.length; i++) {
        var t = (nodes[i].textContent || "").trim();
        if (t && t.length <= 120) return t;
      }
    } catch (e) { }
    return "";
  }
  function wlCardEntry(card) {
    var url = null;
    try { url = videoUrlFrom(card); } catch (e) { url = null; }
    if (!url) return null;
    var title = "";
    try { title = wlCardTitle(card); } catch (e) { title = ""; }
    var channel = "";
    try { channel = wlCardChannel(card); } catch (e) { channel = ""; }
    var thumb = "";
    try {
      var img = card.querySelector("img[src*='ytimg.com']");
      var src = (img && (img.currentSrc || img.src)) || "";
      if (src && src.indexOf("https://") === 0) thumb = src.split(" ")[0];
    } catch (e) { thumb = ""; }
    if (!thumb) thumb = wlThumb(wlId(url));
    return { id: wlId(url), url: url, title: title || "Untitled", channel: channel, thumb: thumb, addedAt: Date.now() };
  }
  function wlIsVideoUrl(raw) {
    if (!raw) return false;
    var url = null;
    try { url = new URL(raw, location.href); } catch (e) { return false; }
    if (url.protocol !== "https:") return false;
    var host = url.hostname.toLowerCase();
    if (host === "youtu.be") return true;
    if (host === "youtube.com" || host.slice(-12) === ".youtube.com") {
      return /\/watch/i.test(url.pathname) || /^\/shorts\//i.test(url.pathname) || /^\/live\//i.test(url.pathname);
    }
    return false;
  }
  function wlEntryFromDrop(event) {
    var dt = null;
    try { dt = event.dataTransfer; } catch (e) { dt = null; }
    if (!dt) return null;
    try {
      var tagged = dt.getData(WL_MIME);
      if (tagged) {
        var parsed = JSON.parse(tagged);
        if (parsed && typeof parsed.url === "string" && wlIsVideoUrl(parsed.url)) {
          return {
            id: wlId(parsed.url),
            url: parsed.url,
            title: (typeof parsed.title === "string" && parsed.title.trim()) || "Untitled",
            channel: (typeof parsed.channel === "string" && parsed.channel.trim()) || "",
            thumb: (typeof parsed.thumb === "string" && parsed.thumb.indexOf("https://") === 0) ? parsed.thumb : wlThumb(wlId(parsed.url)),
            addedAt: Date.now()
          };
        }
      }
    } catch (e) { /* fall through to plain URL payloads */ }
    var payloads = [];
    try { payloads.push(dt.getData("text/uri-list") || ""); } catch (e) { /* next */ }
    try { payloads.push(dt.getData("text/plain") || ""); } catch (e) { /* next */ }
    try { payloads.push(dt.getData("text/html") || ""); } catch (e) { /* next */ }
    for (var i = 0; i < payloads.length; i++) {
      var lines = String(payloads[i]).split(/\r?\n/);
      for (var j = 0; j < lines.length; j++) {
        var token = lines[j].trim();
        if (!token || token.charAt(0) === "#") continue;
        var candidate = token.split(/\s+/)[0];
        if (wlIsVideoUrl(candidate)) {
          return { id: wlId(candidate), url: candidate, title: "Untitled", channel: "", thumb: wlThumb(wlId(candidate)), addedAt: Date.now() };
        }
      }
    }
    // Last resort: fish a video URL out of HTML payloads (bare image drags
    // carry <img> markup instead of a link).
    var html = payloads.join("\n").replace(/&amp;/g, "&");
    var found = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^"'<>\s]*|shorts\/[\w-]+|live\/[\w-]+)|youtu\.be\/[\w-]+)/i.exec(html);
    if (found && wlIsVideoUrl(found[0])) {
      var fished = found[0];
      return { id: wlId(fished), url: fished, title: "Untitled", channel: "", thumb: wlThumb(wlId(fished)), addedAt: Date.now() };
    }
    return null;
  }
  // Add-only (unlike wlToggle, dropping an already-saved video never
  // removes it — it just reports that it is already there).
  function wlAdd(entry) {
    if (!entry || typeof entry.url !== "string" || !wlIsVideoUrl(entry.url)) return false;
    if (wlFind(entry.url)) return false;
    var items = wlRead();
    items.unshift({
      id: wlId(entry.url),
      url: entry.url,
      title: entry.title || "Untitled",
      channel: entry.channel || "",
      thumb: entry.thumb || wlThumb(wlId(entry.url)),
      addedAt: Date.now()
    });
    wlWrite(items);
    wlRefreshUI();
    return true;
  }
  function wlSetHot(el, hot) {
    try {
      if (hot) {
        el.setAttribute("data-yood-drop-hot", "true");
        el.style.outline = "2px solid #3ea6ff";
        el.style.outlineOffset = "2px";
      } else {
        el.removeAttribute("data-yood-drop-hot");
        el.style.outline = "";
        el.style.outlineOffset = "";
      }
    } catch (e) { /* visual only */ }
  }
  var wlHotEl = null;
  function wlClearHot() {
    if (wlHotEl) { wlSetHot(wlHotEl, false); wlHotEl = null; }
  }
  function wlDropZone(node) {
    try {
      if (node instanceof Element && node.closest) return node.closest(WL_DROP_SELECTOR);
    } catch (e) { /* no zone */ }
    return null;
  }
  document.addEventListener("dragstart", function (event) {
    try {
      if (!(event.target instanceof Element) || !event.target.closest || !event.dataTransfer) return;
      var entry = null;
      var card = event.target.closest(CARD_SELECTOR);
      if (card) {
        entry = wlCardEntry(card);
      } else {
        // Reel, player area, bare thumbnails: a dragged <img> carries only
        // its image URL, so enrich from the video on screen instead.
        var onShorts = /youtube\.com\/shorts\//i.test(location.href);
        var reel = null;
        try { reel = event.target.closest("ytd-reel-video-renderer, ytd-shorts"); } catch (e) { reel = null; }
        if (reel && onShorts) {
          entry = wlCurrent(location.href);
          try {
            var reelImg = reel.querySelector("img[src*='ytimg.com']");
            var reelSrc = reelImg && (reelImg.currentSrc || reelImg.src);
            if (reelSrc && reelSrc.indexOf("https://") === 0) entry.thumb = reelSrc.split(" ")[0];
          } catch (e) { /* canonical thumb kept */ }
        } else {
          var meta = null;
          try { meta = event.target.closest("ytd-watch-metadata, #movie_player"); } catch (e) { meta = null; }
          if (meta && /youtube\.com\/(watch|live\/)/i.test(location.href)) entry = wlCurrent(location.href);
        }
      }
      if (!entry || !entry.url) return;
      try { event.dataTransfer.setData(WL_MIME, JSON.stringify({ url: entry.url, title: entry.title, channel: entry.channel, thumb: entry.thumb })); } catch (e) { }
      try { event.dataTransfer.setData("text/plain", entry.url); } catch (e2) { }
      try { event.dataTransfer.setData("text/uri-list", entry.url); } catch (e3) { }
      try { event.dataTransfer.effectAllowed = "copy"; } catch (e4) { }
    } catch (e) { /* native drag still carries the link URL */ }
  }, true);
  document.addEventListener("dragover", function (event) {
    try {
      var zone = event.target ? wlDropZone(event.target) : null;
      if (!zone || !event.dataTransfer) { if (!zone) wlClearHot(); return; }
      // Always allow the drop on Yood zones and validate on drop: Chrome hides
      // custom drag types during dragover, so type-checking here breaks link drags.
      event.preventDefault();
      try { event.dataTransfer.dropEffect = "copy"; } catch (e) { /* hint only */ }
      if (wlHotEl !== zone) { wlClearHot(); wlHotEl = zone; wlSetHot(zone, true); }
    } catch (e) { /* never break the page */ }
  }, true);
  document.addEventListener("drop", function (event) {
    try {
      var zone = event.target ? wlDropZone(event.target) : null;
      if (!zone) return;
      event.preventDefault();
      event.stopPropagation();
      wlClearHot();
      var entry = wlEntryFromDrop(event);
      if (!entry) return;
      if (wlFind(entry.url)) { laterToast(yoodT("alreadyIn")); return; }
      wlAdd(entry);
      laterToast(yoodT("savedTo"));
    } catch (e) { /* never break the page */ }
  }, true);
  // Middle-click (wheel) on any video adds it to Watch later instead of
  // opening a new tab. Add-only, never removes, never navigates.
  function yoodInstallMiddleClick() {
    if (window.__YOOD_MIDDLE__) return;
    window.__YOOD_MIDDLE__ = true;
    var pickUrl = function (target) {
      try {
        if (!target || !target.closest) return null;
        var card = target.closest(CARD_SELECTOR);
        if (card) {
          var en = null;
          try { en = wlCardEntry(card); } catch (e) { en = null; }
          if (en && en.url && wlIsVideoUrl(en.url)) return en;
        }
        var link = null;
        try { link = target.closest('a[href*="/watch"], a[href*="/shorts/"], a[href*="/live/"], a[href*="youtu.be/"]'); } catch (e) { link = null; }
        if (link && link.href && wlIsVideoUrl(link.href)) {
          return { url: new URL(link.href, location.href).href, title: "Untitled", channel: "", thumb: "" };
        }
        if (/youtube\.com\/(watch|shorts\/|live\/)/i.test(location.href)) {
          try {
            if (target.closest("ytd-watch-metadata, #movie_player, ytd-reel-video-renderer, ytd-shorts")) {
              return { url: location.href, title: "", channel: "", thumb: "" };
            }
          } catch (e) { }
        }
      } catch (e) { }
      return null;
    };
    var onMiddle = function (event) {
      try {
        if (event.button !== 1) return;
        var t = null;
        try {
          if (event.composedPath) {
            var p = event.composedPath();
            for (var i = 0; i < p.length; i++) { if (p[i] instanceof Element) { t = p[i]; break; } }
          }
          if (!t) t = event.target instanceof Element ? event.target : null;
        } catch (e) { return; }
        if (!t) return;
        var found = pickUrl(t);
        if (!found || !found.url) return;
        event.preventDefault();
        event.stopPropagation();
        try { if (event.stopImmediatePropagation) event.stopImmediatePropagation(); } catch (e) { }
        if (wlFind(found.url)) { laterToast(yoodT("alreadyIn")); return; }
        var title = (found.title || "").trim();
        if (!title || title === "Untitled") {
          try {
            var card2 = t.closest ? t.closest(CARD_SELECTOR) : null;
            var tn = card2 ? card2.querySelector("#video-title, a#video-title, yt-formatted-string#video-title") : null;
            title = ((tn && (tn.getAttribute("aria-label") || tn.textContent)) || "").trim();
          } catch (e) { }
        }
        wlAdd({ url: found.url, title: title || "Untitled", channel: found.channel || "", thumb: found.thumb || wlThumb(wlId(found.url)) });
        laterToast(yoodT("savedTo"));
      } catch (e) { }
    };
    document.addEventListener("mousedown", onMiddle, true);
    document.addEventListener("auxclick", onMiddle, true);
    document.addEventListener("click", function (event) {
      try { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); } } catch (e) { }
    }, true);
  }
  document.addEventListener("dragend", function () { wlClearHot(); }, true);
  document.addEventListener("click", function (event) {
    var panel = document.getElementById("yood-later-panel");
    var pill = document.getElementById("yood-later-pill");
    if (!panel || panel.style.display === "none") return;
    if (panel.contains(event.target) || (pill && pill.contains(event.target))) return;
    panel.style.display = "none";
  });
  document.addEventListener("click", function (event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    var control = null;
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (!(node instanceof Element)) continue;
      if (node.matches("[" + MARK + "], [" + MARK_LATER + "], #yood-later-pill")) {
        control = node;
        break;
      }
    }
    if (!control) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (control.hasAttribute(MARK)) {
      var url = control.getAttribute(MARK);
      if (!url) return;
      if (control.hasAttribute("data-yood-playlist")) yoodDownloadPlaylistFromDom();
      else showDownloadDialog(url);
    } else if (control.hasAttribute(MARK_LATER)) {
      var laterUrl = control.getAttribute(MARK_LATER);
      if (!laterUrl) return;
      if (wlFind(laterUrl)) {
        var existing = wlFind(laterUrl);
        if (existing) wlRemove(existing.id);
        laterToast(yoodT("removedFrom"));
      } else {
        wlToggle(laterUrl);
        laterToast(yoodT("savedTo"));
      }
      wlRefreshUI();
    } else if (control.id === "yood-later-pill") {
      toggleLaterPanel();
    }
  }, true);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      var panel = document.getElementById("yood-later-panel");
      if (panel && panel.style.display !== "none") panel.style.display = "none";
    }
  }, true);

  // ---- Scan loop (event-driven, debounced) ----
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      try {
        scan();
        retitle();
      } catch (e) { /* never break the page */ }
    }, 250);
  }

  function yoodRefreshDownloadLabels() {
    try {
      var btns = document.querySelectorAll("[" + MARK + "]");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        try {
          var want = "";
          try { want = yoodT("downloadWith"); } catch (e) { want = "Download with Yood"; }
          var lbl = b.querySelector("span:last-child");
          if (lbl && lbl.textContent !== want) lbl.textContent = want;
          b.setAttribute("aria-label", yoodT("downloadWith"));
          b.title = yoodT("downloadWith");
        } catch (e) { }
      }
    } catch (e) { }
  }
  function scan() {
    if (!/youtube\.com|youtu\.be/i.test(location.hostname)) return;
    try { yoodInstallMiddleClick(); } catch (e) { }
    try { wlRefreshUI(); } catch (e) { }
    try { yoodRefreshDownloadLabels(); } catch (e) { }
    yoodEnsureAdStyle();
    if (document.querySelector("ytd-app, ytd-page-manager")) {
      var cards = document.querySelectorAll(CARD_SELECTOR);
      for (var i = 0; i < cards.length; i++) {
        try { injectCardButton(cards[i]); } catch (e) { /* next card */ }
      }
      try { injectVideoButton(); } catch (e) { /* next scan */ }
      try { injectMenuDownload(); } catch (e) { /* next scan */ }
      try { ensureLaterPill(); } catch (e) { /* next scan */ }
      try { ensureYoodNav(); } catch (e) { /* next scan */ }
      try { ensurePlayerButton(); } catch (e) { /* next scan */ }
      try { yoodRemoveKnownAds(document); } catch (e) { /* next scan */ }
      try { installPlayerAdSkip(); } catch (e) { /* next scan */ }
    }
  }

  ["yt-navigate-finish", "yt-page-data-updated", "popstate"].forEach(function (event) {
    window.addEventListener(event, schedule);
  });
  // A menu context belongs to the page that opened it; never carry it
  // across SPA navigations.
  window.addEventListener("yt-navigate-finish", function () { yoodMenuContext = null; });
  window.addEventListener("yt-navigate-finish", function () {
    setTimeout(installPlayerAdSkip, 600);
  });
  window.addEventListener("yt-page-data-updated", function () {
    setTimeout(installPlayerAdSkip, 600);
  });
  retitle();
  installPlayerAdSkip();
  if (document.head) {
    new MutationObserver(retitle).observe(
      document.head.querySelector("title") || document.head,
      { childList: true, subtree: true, characterData: true }
    );
  }
  if (document.documentElement) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n instanceof Element) {
            // New ad renderer? Remove synchronously without a full scan.
            try {
              if (n.matches && n.matches(AD_RENDERER_SELECTOR)) yoodRemoveKnownAds(n.parentNode || document);
              else if (n.querySelector && n.querySelector(AD_RENDERER_SELECTOR)) yoodRemoveKnownAds(n);
            } catch (e) { /* fall through to scan */ }
            // Overflow menu opened? Give it Yood items immediately instead
            // of waiting for the next debounced scan.
            try {
              if (n.matches && n.matches("ytd-menu-popup-renderer, tp-yt-paper-dialog, yt-sheet-view-model, ytd-menu-service-item-renderer")) injectMenuDownload();
              else if (n.querySelector && n.querySelector("ytd-menu-popup-renderer, tp-yt-paper-dialog, yt-sheet-view-model, ytd-menu-service-item-renderer, [role='menuitem']")) injectMenuDownload();
            } catch (e) { /* next scan retries */ }
            schedule();
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { scan(); retitle(); yoodEnsureAdStyle(); }, { once: true });
  } else {
    scan();
  }
})();
