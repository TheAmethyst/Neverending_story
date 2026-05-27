// 1. ИННИЦИАЛИЗАЦИЯ ПРИ ЗАПУСКЕ
document.addEventListener("DOMContentLoaded", () => {
    openPage('home');
});






// 2. НАВИГАЦИЯ
// Переключение страниц
window.openPage = function(page) {
    const content = document.getElementById("content");
    const panel = document.getElementById("yearsPanel");
    
    // ВАЖНО: Объявляем ВСЕ три кнопки и контейнер управления
    const controls = document.getElementById("mainControls");
    const addMemoryBtn = document.getElementById("addMemoryBtn");
    const addGalleryBtn = document.getElementById("addGalleryBtn");
    const addTimelineBtn = document.getElementById("addTimelineBtn");

    // Плавное исчезновение старого контента
    if (content) content.classList.add("fade-out");

    setTimeout(() => {
        // --- 1. СБРОС СОСТОЯНИЯ (Скрываем всё лишнее) ---
        if (panel) panel.style.display = "none";
        if (content) content.innerHTML = "";
        
        // Скрываем кнопки по отдельности для надежности
        if (addMemoryBtn) addMemoryBtn.style.display = "none";
        if (addGalleryBtn) addGalleryBtn.style.display = "none";
        if (addTimelineBtn) addTimelineBtn.style.display = "none";
        
        // Скрываем общий контейнер кнопок (если он есть)
        if (controls) controls.style.display = "none";

        // Сбрасываем фон body на прозрачный (чтобы работал фон #bg)
        document.body.style.backgroundImage = "none";

        // --- 2. ЛОГИКА ДЛЯ ГЛАВНОЙ СТРАНИЦЫ (Home) ---
        if (page === 'home') {
            // Показываем контейнер и все три кнопки
            if (controls) controls.style.display = "flex"; 
            if (addMemoryBtn) addMemoryBtn.style.display = "block";
            if (addTimelineBtn) addTimelineBtn.style.display = "block";
            if (addGalleryBtn) addGalleryBtn.style.display = "block";

            window.updateBackground('main');
        }

        // --- 3. ЛОГИКА ДЛЯ ИСТОРИИ (Love Notes) ---
        else if (page === 'history') {
            if (panel) panel.style.display = "block";
            window.loadPosts(); 
        }

        // --- 4. ЛОГИКА ДЛЯ ГАЛЕРЕИ (Gallery) ---
        else if (page === 'gallery') {
            window.updateBackground('gallery_main');
            window.loadGallery();
        }

        // --- 5. ЛОГИКА ДЛЯ ТАЙМЛАЙНА (Timeline) ---
        else if (page === 'timeline') {
            // Вместо backgroundImage меняем src у основной картинки фона
            const bgImage = document.getElementById('bg');
            if (bgImage) {
                bgImage.src = 'img/timeline_background.jpg';
                bgImage.style.opacity = "1"; // Убеждаемся, что фон виден
            }

            // Загружаем данные таймлайна
            if (typeof window.loadTimeline === 'function') {
                window.loadTimeline();
            }
        }

        // Проявляем новый контент
        if (content) {
            content.classList.remove("fade-out");
            content.classList.add("fade-in");
        }
    }, 300);
};

// Функция смены фона с проверкой на наличие файла и типа устройства
window.updateBackground = function(year) {
    const bgElement = document.getElementById('bg');
    if (!bgElement) return;
    
    let primarySrc = `img/${year}.jpg`;
    const fallbackSrc = `img/main.jpg`;

    // Если экран мобильный (до 768px) и открыта главная страница, подменяем файл
    if (window.innerWidth <= 768 && year === 'main') {
        primarySrc = 'img/main_mobile.jpg';
    }

    // Начинаем затухание
    bgElement.style.opacity = "0.3"; 
    
    const img = new Image();
    img.onload = () => {
        setTimeout(() => {
            bgElement.src = primarySrc;
            bgElement.style.opacity = "1"; // Возвращаем яркость
        }, 300);
    };
    img.onerror = () => {
        setTimeout(() => {
            bgElement.src = fallbackSrc;
            bgElement.style.opacity = "1";
        }, 300);
    };
    img.src = primarySrc;
};






// 3. ФОРМА ДОБАВЛЕНИЯ ПОСТА
// Управление формой
window.openModal = function() {
    const modal = document.getElementById("postModal"); // ID из твоего index.html
    if (modal) {
        window.clearForm(); // Сначала чистим, потом открываем
        modal.style.display = "flex";
    } else {
        console.error("Ошибка: Окно 'postModal' не найдено!");
    }
};

// Закрытие
window.closeModal = function() {
    const modal = document.getElementById("postModal");
    if (modal) {
        modal.style.display = "none";
    }
};

// Превью изображения
window.previewImage = function(input) {
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.src = e.target.result;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
        }
        reader.readAsDataURL(input.files[0]);
    }
}



// Полная очистка
window.clearForm = function() {
    const dateField = document.getElementById('postDate');
    const textField = document.getElementById('postText');
    const fileField = document.getElementById('postImage');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');

    if (dateField) dateField.value = "";
    if (textField) textField.value = "";
    if (fileField) fileField.value = "";
    
    if (preview) {
        preview.src = "";
        preview.style.display = "none";
    }
    if (placeholder) {
        placeholder.style.display = "block";
    }
};





// 4. ФОРМА ДОБАВЛЕНИЯ ФОТО
window.openGalleryModal = function() {
    const modal = document.getElementById("galleryForm");
    if (modal) modal.style.display = "flex";
};

window.closeGalleryForm = function() {
    const modal = document.getElementById("galleryForm");
    if (modal) {
        modal.style.display = "none";
        // Очистка превью
        document.getElementById('galleryImageFile').value = "";
        document.getElementById('galleryImagePreview').style.display = "none";
        document.getElementById('galleryUploadPlaceholder').style.display = "block";
    }
};

// Превью специально для второй формы
window.previewGalleryImage = function(input) {
    const preview = document.getElementById('galleryImagePreview');
    const placeholder = document.getElementById('galleryUploadPlaceholder');
    
    if (input.files && input.files.length > 0) {
        if (input.files.length === 1) {
            // Если одно фото — показываем его как раньше
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.src = e.target.result;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
            }
            reader.readAsDataURL(input.files[0]);
        } else {
            // Если несколько — показываем заглушку с текстом
            preview.style.display = 'none';
            placeholder.style.display = 'block';
            placeholder.innerHTML = `<span class="plus-icon">📸</span><p>Выбрано фото: ${input.files.length}</p>`;
        }
    }
};
