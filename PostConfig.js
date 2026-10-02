window.VSD_CONVERT_URL = null;
window.ICONSEARCH_PATH = null;
window.EMF_CONVERT_URL = null;
EditorUi.enableLogging = false;
EditorUi.enablePlantUml = true;
App.prototype.isDriveDomain = function () { return true; };

// The official cache posts AES blobs that cannot be decrypted outside
// diagrams.net. Collaboration here is the relay in PreConfig against /rt.
Editor.enableRealtimeCache = false;
Editor.p2pSyncNotify = false;
