// ========================================================
// Supabase の設定
// 1. https://supabase.com で新しいプロジェクトを作成
// 2. 下の SUPABASE_URL と SUPABASE_KEY を書き換える
// 3. Supabase で以下を設定する:
//    - Table: "photos"  列: id, created_at, name(text), caption(text), image_url(text), date(text)
//    - Storage: "photos" という名前のバケットを作成（Public にする）
//    - Storage の Policy: anonymous ユーザーのアップロードを許可
// ========================================================
const SUPABASE_URL = 'https://bkxxmqerohnjywfvfdlo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJreHhtcWVyb2huanl3ZnZmZGxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Mjg1OTYsImV4cCI6MjA5NTUwNDU5Nn0.0vWQrm3j0bI5kTswfEkns6G1jiivcIju6Hxw_biNA44';
let db = null;
try {
    if (window.supabase && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) {
    console.warn('Supabase not configured');
}

function compressImage(file, maxSize = 1920, quality = 0.82) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
        };
        img.src = url;
    });
}

// Supabase Image Transform で縮小版を取得
function getThumbUrl(url, width) {
    if (!url || !url.includes('/storage/v1/object/public/')) return url;
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
        + `?width=${width}&resize=contain&quality=75`;
}

// 画面内に入ったときだけ画像を読み込む
const lazyObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            observer.unobserve(img);
        }
    });
}, { rootMargin: '200px' });

document.addEventListener('DOMContentLoaded', () => {

    // --- ギャラリー (index.html) ---
    const photoGrid = document.getElementById('photo-grid');
    const emptyMessage = document.getElementById('empty-message');

    if (photoGrid) {
        loadPhotos();
    }

    // ライトボックス
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    let allPhotos = [];
    let currentLightboxIndex = 0;

    function openLightbox(index) {
        if (!lightbox || index < 0 || index >= allPhotos.length) return;
        currentLightboxIndex = index;
        lightboxImg.src = allPhotos[index].image_url;
        lightbox.style.display = 'flex';
    }

    function showPrev() {
        if (allPhotos.length === 0) return;
        currentLightboxIndex = (currentLightboxIndex - 1 + allPhotos.length) % allPhotos.length;
        lightboxImg.src = allPhotos[currentLightboxIndex].image_url;
    }

    function showNext() {
        if (allPhotos.length === 0) return;
        currentLightboxIndex = (currentLightboxIndex + 1) % allPhotos.length;
        lightboxImg.src = allPhotos[currentLightboxIndex].image_url;
    }

    if (lightbox) {
        document.getElementById('lightbox-overlay').addEventListener('click', () => lightbox.style.display = 'none');
        document.getElementById('lightbox-close').addEventListener('click', () => lightbox.style.display = 'none');
        const prevBtn = document.getElementById('lightbox-prev');
        const nextBtn = document.getElementById('lightbox-next');
        if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); showPrev(); });
        if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); showNext(); });

        document.addEventListener('keydown', (e) => {
            if (lightbox.style.display !== 'flex') return;
            if (e.key === 'Escape') lightbox.style.display = 'none';
            if (e.key === 'ArrowLeft') showPrev();
            if (e.key === 'ArrowRight') showNext();
        });

        // スワイプ対応
        let touchStartX = 0;
        let touchStartY = 0;
        lightbox.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        lightbox.addEventListener('touchend', (e) => {
            const diffX = e.changedTouches[0].clientX - touchStartX;
            const diffY = e.changedTouches[0].clientY - touchStartY;
            // 横スワイプが縦より大きい場合のみ
            if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
                if (diffX > 0) showPrev();
                else showNext();
            }
        }, { passive: true });
    }

    const PAGE_SIZE = 12;
    let currentPage = 0;
    let totalCount = 0;

    async function loadPhotos() {
        if (!db) return;

        const { count } = await db.from('photos').select('*', { count: 'exact', head: true });
        totalCount = count || 0;

        if (totalCount === 0) {
            if (emptyMessage) emptyMessage.style.display = 'block';
            return;
        }

        photoGrid.innerHTML = '';
        currentPage = 0;
        allPhotos = [];
        await loadMorePhotos();

        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', loadMorePhotos);
        }
    }

    async function loadMorePhotos() {
        const from = currentPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data: photos, error } = await db
            .from('photos')
            .select('*')
            .order('id', { ascending: false })
            .range(from, to);

        if (error || !photos) return;

        allPhotos.push(...photos);

        photos.forEach((photo, index) => {
            const card = document.createElement('div');
            card.className = 'photo-card';

            const img = document.createElement('img');
            img.alt = photo.caption || '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.style.cursor = 'pointer';
            img.dataset.src = getThumbUrl(photo.image_url, 480);
            lazyObserver.observe(img);
            img.addEventListener('click', () => {
                const idx = allPhotos.findIndex(p => p.id === photo.id);
                if (idx >= 0) openLightbox(idx);
            });

            card.appendChild(img);

            if (photo.caption || photo.name || photo.date) {
                const info = document.createElement('div');
                info.className = 'photo-info';

                if (photo.caption) {
                    const caption = document.createElement('p');
                    caption.className = 'photo-caption';
                    caption.textContent = photo.caption;
                    info.appendChild(caption);
                }

                const meta = document.createElement('span');
                meta.className = 'photo-meta';
                const parts = [];
                if (photo.name) parts.push(photo.name);
                if (photo.date) parts.push(photo.date);
                meta.textContent = parts.join('  —  ');
                info.appendChild(meta);

                card.appendChild(info);
            }

            photoGrid.appendChild(card);
            setTimeout(() => card.classList.add('visible'), index * 120);
        });

        currentPage++;
        const loadedCount = currentPage * PAGE_SIZE;
        const loadMoreWrapper = document.getElementById('load-more-wrapper');
        if (loadMoreWrapper) {
            loadMoreWrapper.style.display = loadedCount >= totalCount ? 'none' : 'block';
        }
    }

    // --- 投稿フォーム (post.html) ---
    const photoInput = document.getElementById('photo-input');
    const previewImg = document.getElementById('preview-img');
    const uploadArea = document.getElementById('upload-area');
    const postSubmit = document.getElementById('post-submit');
    const postError = document.getElementById('post-error');
    const postFormWrapper = document.getElementById('post-form-wrapper');
    const postThanks = document.getElementById('post-thanks');
    const postNameInput = document.getElementById('post-name');

    // 名前の自動入力＆保存
    if (postNameInput) {
        const savedName = localStorage.getItem('user-name');
        if (savedName) postNameInput.value = savedName;
        postNameInput.addEventListener('input', () => {
            const trimmed = postNameInput.value.trim();
            if (trimmed) {
                localStorage.setItem('user-name', trimmed);
            } else {
                localStorage.removeItem('user-name');
            }
        });
    }

    let compressedBlob = null;

    const deletePhoto = document.getElementById('delete-photo');
    if (deletePhoto) {
        deletePhoto.addEventListener('click', () => {
            compressedBlob = null;
            photoInput.value = '';
            if (previewImg) previewImg.src = '';
            document.getElementById('preview-container').style.display = 'none';
            if (uploadArea) uploadArea.style.display = 'flex';
            document.getElementById('preview-actions').style.display = 'none';
        });
    }

    if (photoInput) {
        photoInput.addEventListener('change', async () => {
            const file = photoInput.files[0];
            if (!file) return;
            if (file.size > 20 * 1024 * 1024) {
                showError('20MB 以下の画像を選んでください / Please choose an image under 20MB');
                return;
            }
            compressedBlob = await compressImage(file);
            const url = URL.createObjectURL(compressedBlob);
            if (previewImg) {
                previewImg.src = url;
                document.getElementById('preview-container').style.display = 'inline-block';
                if (uploadArea) uploadArea.style.display = 'none';
            }
            document.getElementById('preview-actions').style.display = 'flex';
        });
    }

    if (postSubmit) {
        postSubmit.addEventListener('click', async () => {
            if (!compressedBlob) {
                showError('写真を選んでください / Please choose a photo');
                return;
            }
            if (!db) {
                showError('Supabase の設定が必要です');
                return;
            }

            // 管理人名のチェック
            const inputName = (postNameInput?.value || '').trim().toLowerCase();
            const reservedNames = ['管理人', '管理者', 'admin', 'administrator', 'えはや', 'ehaya'];
            if (reservedNames.some(r => inputName === r.toLowerCase())) {
                const { data: { session } } = await db.auth.getSession();
                if (!session) {
                    showError('この名前は使えません / This name is reserved');
                    return;
                }
            }

            postSubmit.disabled = true;
            postSubmit.textContent = '投稿中... / Posting...';

            const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

            const { error: uploadError } = await db.storage
                .from('photos')
                .upload(fileName, compressedBlob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });

            if (uploadError) {
                showError('アップロードに失敗しました / Upload failed');
                postSubmit.disabled = false;
                postSubmit.textContent = '投稿する / Post';
                return;
            }

            const { data: urlData } = db.storage.from('photos').getPublicUrl(fileName);

            const name = document.getElementById('post-name')?.value.trim() || '';
            const caption = document.getElementById('post-caption')?.value.trim() || '';
            const now = new Date();
            const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

            const { data: inserted, error: insertError } = await db.from('photos').insert([{
                name: name || null,
                caption: caption || null,
                image_url: urlData.publicUrl,
                date,
            }]).select();

            if (insertError) {
                showError('投稿に失敗しました / Post failed');
                postSubmit.disabled = false;
                postSubmit.textContent = '投稿する / Post';
                return;
            }

            if (inserted && inserted[0]) {
                const myIds = JSON.parse(localStorage.getItem('my-post-ids') || '[]');
                myIds.push(String(inserted[0].id));
                localStorage.setItem('my-post-ids', JSON.stringify(myIds));
            }

            if (postFormWrapper) postFormWrapper.style.display = 'none';
            if (postThanks) postThanks.style.display = 'block';

            postSubmit.disabled = false;
            postSubmit.textContent = 'Post';
        });
    }

    // もう一度投稿する
    const postAgain = document.getElementById('post-again');
    if (postAgain) {
        postAgain.addEventListener('click', () => {
            compressedBlob = null;
            if (photoInput) photoInput.value = '';
            if (previewImg) previewImg.src = '';
            const previewContainer = document.getElementById('preview-container');
            if (previewContainer) previewContainer.style.display = 'none';
            if (uploadArea) uploadArea.style.display = 'flex';
            const previewActions = document.getElementById('preview-actions');
            if (previewActions) previewActions.style.display = 'none';
            const nameInput = document.getElementById('post-name');
            const captionInput = document.getElementById('post-caption');
            if (nameInput) nameInput.value = '';
            if (captionInput) captionInput.value = '';
            if (postThanks) postThanks.style.display = 'none';
            if (postFormWrapper) postFormWrapper.style.display = 'flex';
        });
    }

    // --- Contact フォーム (contact.html) ---
    const contactForm = document.getElementById('contact-form');
    const contactThanks = document.getElementById('contact-thanks');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const response = await fetch('https://formspree.io/f/xredrjyr', {
                method: 'POST',
                body: new FormData(contactForm),
                headers: { 'Accept': 'application/json' }
            });
            if (response.ok) {
                contactForm.style.display = 'none';
                contactThanks.style.display = 'block';
            }
        });
    }

    function showError(msg) {
        if (!postError) return;
        postError.textContent = msg;
        postError.style.display = 'block';
    }
});
