// Подготовка и загрузка фото: уменьшаем до разумного размера,
// делаем миниатюру для сетки и кладём обе версии в хранилище.
(function () {
    'use strict';
    const FULL_SIDE = 2048;     // длинная сторона полной версии
    const FULL_QUALITY = 0.86;
    const THUMB_SIDE = 640;     // миниатюра для сетки галереи
    const THUMB_QUALITY = 0.8;

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => resolve({ img, url });
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
            img.src = url;
        });
    }

    function toCanvas(source, sw, sh, maxSide) {
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';            // у PNG с прозрачностью фон станет белым, а не чёрным
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, w, h);
        return canvas;
    }

    function canvasToBlob(canvas, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сжать фото'))), 'image/jpeg', quality);
        });
    }

    const images = {
        isImageFile(file) {
            return /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name);
        },

        // Возвращает { full, thumb, width, height }
        async prepare(file) {
            if (!images.isImageFile(file)) throw new Error(`«${file.name}» — это не фото`);
            let loaded;
            try {
                loaded = await loadImage(file);
            } catch (e) {
                throw new Error(/\.(heic|heif)$/i.test(file.name)
                    ? `«${file.name}» в формате HEIC, браузер на компьютере его не открывает. Загрузи это фото с телефона или сохрани как JPEG.`
                    : `Не получилось открыть «${file.name}»`);
            }
            try {
                const { img } = loaded;
                // naturalWidth/Height уже учитывают поворот из EXIF в современных браузерах
                const full = toCanvas(img, img.naturalWidth, img.naturalHeight, FULL_SIDE);
                const thumb = toCanvas(full, full.width, full.height, THUMB_SIDE);
                return {
                    full: await canvasToBlob(full, FULL_QUALITY),
                    thumb: await canvasToBlob(thumb, THUMB_QUALITY),
                    width: full.width,
                    height: full.height
                };
            } finally {
                URL.revokeObjectURL(loaded.url);
            }
        },

        // Загружает обе версии в хранилище. Возвращает данные для строки photos.
        async uploadPrepared(prepared) {
            const base = `${new Date().getFullYear()}/${uuid()}`;
            const path = `${base}.jpg`;
            const thumbPath = `${base}_t.jpg`;
            await api.upload(path, prepared.full);
            try {
                await api.upload(thumbPath, prepared.thumb);
            } catch (e) {
                api.removeFiles([path]).catch(() => {});
                throw e;
            }
            return { path, thumb_path: thumbPath, width: prepared.width, height: prepared.height };
        },

        // Полный цикл: сжать, загрузить, записать в таблицу photos.
        // links: { memory_id } или { event_id } или пусто для галереи.
        async addPhoto(file, links) {
            const prepared = await images.prepare(file);
            const files = await images.uploadPrepared(prepared);
            try {
                return await api.insert('photos', Object.assign({}, files, links || {}));
            } catch (e) {
                api.removeFiles([files.path, files.thumb_path]).catch(() => {});
                throw e;
            }
        },

        // Аватар: одна небольшая картинка, без записи в таблицу photos
        async uploadAvatar(file) {
            if (!images.isImageFile(file)) throw new Error('Это не фото');
            let loaded;
            try { loaded = await loadImage(file); } catch (e) { throw new Error('Не получилось открыть фото'); }
            try {
                const { img } = loaded;
                const canvas = toCanvas(img, img.naturalWidth, img.naturalHeight, 512);
                const blob = await canvasToBlob(canvas, 0.85);
                const path = `avatars/${uuid()}.jpg`;
                await api.upload(path, blob);
                return path;
            } finally {
                URL.revokeObjectURL(loaded.url);
            }
        },

        // Удаляет строку фото и сами файлы
        async deletePhoto(photo) {
            await api.remove('photos', photo.id);
            api.removeFiles([photo.path, photo.thumb_path]).catch(() => {});
        },

        isPortrait(photo) {
            return photo && photo.height > photo.width;
        }
    };

    window.images = images;
})();
