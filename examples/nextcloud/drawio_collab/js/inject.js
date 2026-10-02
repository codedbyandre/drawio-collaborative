(function () {
    var orig = HTMLIFrameElement.prototype.setAttribute;

    HTMLIFrameElement.prototype.setAttribute = function (name, value) {
        if (this.id !== 'iframeEditor' || name !== 'src' || typeof value !== 'string' || value.indexOf('rt=') !== -1) {
            return orig.call(this, name, value);
        }

        var iframe = this;
        var fileId = iframe.getAttribute('data-id') || '';
        var settled = false;

        function open(next) {
            if (settled) {
                return;
            }
            settled = true;
            orig.call(iframe, 'src', next);
        }

        // A failed token must still open the editor. Collaboration stays off.
        // A hanging request must not leave a blank iframe.
        setTimeout(function () {
            open(value);
        }, 4000);

        if (!fileId || typeof OC === 'undefined' || typeof fetch !== 'function') {
            open(value);
            return;
        }

        fetch(OC.generateUrl('/apps/drawio_collab/token?fileId=' + encodeURIComponent(fileId)), {
            credentials: 'same-origin',
            headers: { requesttoken: OC.requestToken },
        }).then(function (response) {
            return response.ok ? response.json() : null;
        }).then(function (data) {
            if (!data || !data.rt || !data.room) {
                open(value);
                return;
            }

            var next = new URL(value, window.location.href);
            next.searchParams.set('sync', 'manual');
            next.searchParams.set('room', data.room);
            next.searchParams.set('rt', data.rt);
            next.searchParams.set('who', data.who || '');
            next.searchParams.set('uid', data.uid || '');
            open(next.toString());
        }).catch(function () {
            open(value);
        });
    };
})();
