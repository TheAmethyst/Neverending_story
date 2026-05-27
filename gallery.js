// Глобальные переменные для контроля пагинации галереи
let galleryOffset = 0;
const galleryLimit = 30; // Размер одной порции загрузки
let isLoadingGallery = false;
let hasMoreGallery = true;

window.loadGallery = async function() {
    const content = document.getElementById("content");
    if (!content) return;
    
    // Сброс состояния при открытии экрана
    galleryOffset = 0;
    hasMoreGallery = true;
    isLoadingGallery = false;
    window.galleryData = []; // Хранилище загруженных данных
    
    content.innerHTML = "<div class='loader'>Загрузка фото...</div>";

    await fetchGalleryBatch(true);
    
    // Подключение слушателя прокрутки
    window.removeEventListener('scroll', handleGalleryScroll);
    window.addEventListener('scroll', handleGalleryScroll);
};

async function fetchGalleryBatch(isFirstLoad = false) {
    if (isLoadingGallery || !hasMoreGallery) return;
    isLoadingGallery = true;

    const { data, error } = await window.db
        .from("gallery")
        .select("id, image")
        .not("image", "is", null)
        .order('created_at', { ascending: false })
        .range(galleryOffset, galleryOffset + galleryLimit - 1);

    isLoadingGallery = false;

    if (error) {
        console.error("Ошибка галереи:", error);
        if (isFirstLoad) document.getElementById("content").innerHTML = "<p>Ошибка загрузки</p>";
        return;
    }

    if (data.length < galleryLimit) {
        hasMoreGallery = false; // Фотографии закончились
    }
    
    galleryOffset += galleryLimit;

    if (data.length > 0) {
        window.galleryData.push(...data);
        
        if (isFirstLoad) {
            renderGallery(data); // Первичная отрисовка
        } else {
            appendGalleryItems(data); // Добавление в существующую сетку
        }
    } else if (isFirstLoad) {
        document.getElementById("content").innerHTML = "<p>Галерея пуста</p>";
    }
}

// Обработчик события прокрутки
window.handleGalleryScroll = function() {
    // Проверяем, активна ли сейчас галерея (есть ли сетка на экране)
    const galleryGrid = document.querySelector('.gallery-grid');
    if (!galleryGrid) return; 

    const scrollY = window.scrollY || window.pageYOffset;
    const windowHeight = window.innerHeight;
    
    // Более надежное вычисление высоты документа для мобильных браузеров
    const documentHeight = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight,
        document.body.clientHeight, document.documentElement.clientHeight
    );

    // Загружаем следующую партию, когда до конца страницы остается 400px
    if (scrollY + windowHeight >= documentHeight - 400) {
        fetchGalleryBatch();
    }
};

window.appendGalleryItems = function(data) {
    const grid = document.querySelector('.gallery-grid');
    if (!grid) return;

    data.forEach(p => {
        const div = document.createElement("div");
        div.className = "gallery-item";
        
        // ВНИМАНИЕ: скопируй структуру кнопок и onclick из твоей функции renderGallery, 
        // чтобы новые фото открывались и удалялись так же, как и первые 30.
        div.innerHTML = `
            <img src="${img.image}" loading="lazy" onclick="openFullScreenImage('${img.image}', ${img.id})">
            <button class="gallery-delete-btn" onclick="deleteGalleryPhoto(${p.id}, '${p.image}')">&times;</button>
        `;
        
        grid.appendChild(div);
    });
};

window.addGalleryPhoto = async function() {
    const fileInput = document.getElementById("galleryImageFile");
    const files = fileInput.files; // Теперь это список файлов
    const saveBtn = document.getElementById("saveGalleryBtn");

    if (files.length === 0) return alert("Выбери хотя бы одно фото");

    saveBtn.disabled = true;
    let originalText = saveBtn.textContent;

    try {
        // Проходим циклом по каждому выбранному файлу
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            saveBtn.textContent = `Загрузка ${i + 1}/${files.length}...`;

            // 1. Сжатие
            const compressed = await compressImage(file);
            const fileName = `gal_${Date.now()}_${i}`;
            
            // 2. Загрузка в Storage
            const { error: storageError } = await window.db.storage
                .from("post-images")
                .upload(fileName, compressed);
            
            if (storageError) throw storageError;

            const { data: urlData } = window.db.storage.from("post-images").getPublicUrl(fileName);

            // 3. Запись в базу gallery
            const { error: insertError } = await window.db.from("gallery").insert([
                { image: urlData.publicUrl }
            ]);

            if (insertError) throw insertError;
        }

        // После завершения всех загрузок
        window.closeGalleryForm();
        // Проверяем, какой режим сейчас активен в приложении
        const addMemoryBtn = document.getElementById("addMemoryBtn");
        const isHomePage = addMemoryBtn && addMemoryBtn.style.display === "block";

        if (isHomePage) {
            // На главной странице нам НЕ нужна галерея. Очищаем контент.
            const content = document.getElementById("content");
            if (content) content.innerHTML = "";
            console.log("Загрузка завершена: экран очищен (режим Home)");
        } else {
            // Только если мы УЖЕ находимся в разделе Gallery, обновляем сетку
            window.loadGallery();
        }
    } catch (err) {
        console.error("Ошибка массовой загрузки:", err);
        alert("Произошла ошибка при загрузке одного из фото");
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
};



window.deleteGalleryPhoto = async function(photoId) {
    // 1. Логируем для проверки
    console.log("Попытка удаления фото с ID:", photoId);

    if (!confirm("Удалить это фото навсегда?")) return;

    try {
        // Получаем данные о фото
        const { data: photoData, error: fetchError } = await window.db
            .from("gallery")
            .select("image")
            .eq("id", photoId)
            .single();

        if (fetchError || !photoData) {
            console.error("Фото не найдено в базе:", fetchError);
            alert("Ошибка: Запись не найдена в базе данных.");
            return;
        }

        const imageUrl = photoData.image;
        const fileName = imageUrl.split('/').pop();

        // 2. Удаление из Storage
        if (fileName) {
            const { error: storageError } = await window.db.storage
                .from("post-images")
                .remove([fileName]);
            
            if (storageError) console.warn("Storage error:", storageError);
        }

        // 3. Удаление из Таблицы
        // Явно приводим photoId к числу на случай, если пришла строка
        const { error: dbError } = await window.db
            .from("gallery")
            .delete()
            .eq("id", Number(photoId)); 

        if (dbError) throw dbError;

        console.log("Удаление успешно завершено");
        
        // 4. Мгновенное обновление интерфейса
        await window.loadGallery();
        
    } catch (err) {
        console.error("Ошибка при удалении:", err);
        alert("Ошибка: " + err.message);
    }
};




window.renderGallery = function(images) {
    const content = document.getElementById("content");
    content.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "gallery-grid";

    images.forEach(img => {
        const item = document.createElement("div");
        item.className = "gallery-item";
        
        // Добавляем HTML для фото И кнопку удаления
        item.innerHTML = `
            <img src="${img.image}" loading="lazy" onclick="openFullScreenImage('${img.image}', ${img.id})">
            <button class="gallery-delete-btn" onclick="window.deleteGalleryPhoto(${img.id})">
                &times;
            </button>
        `;
        grid.appendChild(item);
    });

    content.appendChild(grid);
};

// Открытие фото на весь экран
window.openFullScreenImage = function(imageUrl, id) {
    let overlay = document.getElementById('fullscreenOverlay');
    
    // Создаем оверлей, если его еще нет
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fullscreenOverlay';
        overlay.className = 'full-image-overlay';
        document.body.appendChild(overlay);
    }

    // Внедряем фото и кнопку удаления
    overlay.innerHTML = `
        <img src="${imageUrl}">
        <button class="fullscreen-delete-btn" onclick="event.stopPropagation(); deleteGalleryPhoto(${id}, '${imageUrl}'); closeFullScreen()">удалить</button>
    `;

    // Закрытие при клике в любое место, кроме кнопки "удалить"
    overlay.onclick = function(e) {
        if (!e.target.classList.contains('fullscreen-delete-btn')) {
            closeFullScreen();
        }
    };

    overlay.style.display = 'flex';
};

// Закрытие полноэкранного режима
window.closeFullScreen = function() {
    const overlay = document.getElementById('fullscreenOverlay');
    if (overlay) overlay.style.display = 'none';
};
