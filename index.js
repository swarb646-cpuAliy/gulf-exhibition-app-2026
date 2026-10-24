require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const admin = require('firebase-admin');

let ImageKit = null;
try {
    ImageKit = require('@imagekit/nodejs');
} catch (_) {
    console.log('ImageKit غير مثبت؛ سيعمل المعرض دون الخدمة الخارجية.');
}


const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const VISITOR_DIR = path.join(ROOT, 'visitor');
const ADMIN_DIR = path.join(ROOT, 'admin');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(ROOT, 'data.json');

const imagekit = (
    process.env.IMAGEKIT_PRIVATE_KEY && ImageKit
) ? new ImageKit({ privateKey: process.env.IMAGEKIT_PRIVATE_KEY }) : null;


fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* =========================================
   FIREBASE
========================================= */

let db = null;
let firebaseEnabled = false;

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        );

        const exhibitionApp =
            admin.apps.find(app => app.name === 'gulf-exhibition') ||
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL:
                    'https://interactive-exhibition-default-rtdb.firebaseio.com'
            }, 'gulf-exhibition');

        db = admin.database(exhibitionApp);
        firebaseEnabled = true;

        console.log('Firebase: ENABLED');
    } else {
        console.log('Firebase: DISABLED - environment variable not found');
    }
} catch (err) {
    console.error('Firebase initialization error:', err.message);
    console.log('Server will continue using local data.json');
}

/* =========================================
   DEFAULT DATA
========================================= */

const DEFAULT_DATA = {
    settings: {
        name: 'المعرض التفاعلي',
        description: 'وجهتك لاكتشاف أفضل العروض والمنتجات',
        whatsapp: '',
        phone: '',
        email: '',
        website: '',
        x: '',
        announcement: ''
    },

    categories: [
        {
            id: crypto.randomUUID(),
            name: 'عقارات',
            icon: '🏠'
        },
        {
            id: crypto.randomUUID(),
            name: 'سيارات',
            icon: '🚗'
        },
        {
            id: crypto.randomUUID(),
            name: 'محلات',
            icon: '🏪'
        },
        {
            id: crypto.randomUUID(),
            name: 'جوالات وأجهزة',
            icon: '📱'
        },
        {
            id: crypto.randomUUID(),
            name: 'أثاث',
            icon: '🛋️'
        },
        {
            id: crypto.randomUUID(),
            name: 'أخرى',
            icon: '📦'
        }
    ],

    listings: []
};

/* =========================================
   DATA HELPERS
========================================= */

function cloneDefaultData() {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function normalizeData(value) {
    const source =
        value && typeof value === 'object'
            ? value
            : {};

    const result = {
        settings: {
            ...DEFAULT_DATA.settings,
            ...(source.settings || {})
        },

        categories: Array.isArray(source.categories)
            ? source.categories
            : [],

        listings: Array.isArray(source.listings)
            ? source.listings
            : []
    };

    return result;
}

function loadLocalData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const initialData = cloneDefaultData();

            fs.writeFileSync(
                DATA_FILE,
                JSON.stringify(initialData, null, 2),
                'utf8'
            );

            return initialData;
        }

        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);

        return normalizeData(parsed);
    } catch (err) {
        console.error('Data load error:', err.message);

        return cloneDefaultData();
    }
}

let data = loadLocalData();

/* =========================================
   LOCAL SAVE
========================================= */

function saveLocalData() {
    const temp = DATA_FILE + '.tmp';

    fs.writeFileSync(
        temp,
        JSON.stringify(data, null, 2),
        'utf8'
    );

    fs.renameSync(temp, DATA_FILE);
}

/* =========================================
   FIREBASE SAVE
========================================= */

async function saveToFirebase() {
    if (!firebaseEnabled || !db) {
        return;
    }

    try {
        await db.ref('exhibition/data').set(data);

        console.log('Firebase sync: saved');
    } catch (err) {
        console.error(
            'Firebase save error:',
            err.message
        );
    }
}

/* =========================================
   MAIN SAVE
========================================= */

function saveData() {
    try {
        saveLocalData();
    } catch (err) {
        console.error(
            'Local data save error:',
            err.message
        );
    }

    if (firebaseEnabled) {
        saveToFirebase().catch(err => {
            console.error(
                'Firebase background save error:',
                err.message
            );
        });
    }
}

/* =========================================
   RESTORE FROM FIREBASE
========================================= */

async function restoreFromFirebase() {
    if (!firebaseEnabled || !db) {
        return;
    }

    try {
        const snapshot = await db
            .ref('exhibition/data')
            .once('value');

        const cloudData = snapshot.val();

        if (
            cloudData &&
            typeof cloudData === 'object'
        ) {
            data = normalizeData(cloudData);

            saveLocalData();

            console.log(
                'Firebase sync: latest data restored'
            );
        } else {
            await db
                .ref('exhibition/data')
                .set(data);

            console.log(
                'Firebase sync: initial data uploaded'
            );
        }
    } catch (err) {
        console.error(
            'Firebase restore error:',
            err.message
        );

        console.log(
            'Using local data.json instead'
        );
    }
}

/* =========================================
   GENERAL HELPERS
========================================= */

function clean(value) {
    return String(value ?? '').trim();
}

function deleteFileUrl(fileUrl) {
    if (!fileUrl || typeof fileUrl !== 'string') {
        return;
    }

    if (!fileUrl.startsWith('/uploads/')) {
        return;
    }

    const filename = path.basename(fileUrl);
    const filePath = path.join(
        UPLOAD_DIR,
        filename
    );

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (err) {
        console.error(
            'File delete error:',
            err.message
        );
    }
}

function normalizeImages(value) {
    try {
        const parsed = JSON.parse(value || '[]');

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter(
            x =>
                typeof x === 'string' &&
                x.startsWith('/uploads/')
        );
    } catch {
        return [];
    }
}


async function uploadToImageKit(file) {
    if (!file || !process.env.IMAGEKIT_PRIVATE_KEY) {
        return null;
    }

    try {
        const result = await imagekit.files.upload({
            file: fs.createReadStream(file.path),
            fileName: file.filename,
            useUniqueFileName: true,
            folder: '/exhibition'
        });

        return result.url;
    } catch (err) {
        console.error(
            'ImageKit upload error:',
            err.message
        );

        return null;
    }
}
               
/* =========================================
   MULTER
========================================= */

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    filename: (req, file, cb) => {
        const ext = path
            .extname(file.originalname || '')
            .toLowerCase();

        const safeExt =
            ext.replace(/[^a-z0-9.]/gi, '') || '';

        cb(
            null,
            `${Date.now()}-${crypto
                .randomBytes(8)
                .toString('hex')}${safeExt}`
        );
    }
});

const upload = multer({
    storage,

    limits: {
        files: 20,
        fileSize: 500 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        if (
            file.mimetype.startsWith('image/') ||
            file.mimetype.startsWith('video/')
        ) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    'نوع الملف غير مسموح'
                )
            );
        }
    }
});

/* =========================================
   ADMIN AUTH
========================================= */

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD || '123456';

const adminTokens = new Set();

function requireAdmin(req, res, next) {
    const token =
        req.headers['x-admin-token'];

    if (
        !token ||
        !adminTokens.has(token)
    ) {
        return res.status(401).json({
            success: false,
            message: 'غير مصرح'
        });
    }

    next();
}

/* =========================================
   EXPRESS
========================================= */

app.use(
    express.json({
        limit: '5mb'
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '5mb'
    })
);

/* =========================================
   STATIC UPLOADS
========================================= */

app.use(
    '/uploads',
    express.static(UPLOAD_DIR)
);

/* =========================================
   ADMIN LOGIN
========================================= */

app.post(
    '/api/admin-login',
    (req, res) => {
        const password = clean(
            req.body.password
        );

        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({
                success: false,
                message:
                    'كلمة المرور غير صحيحة'
            });
        }

        const token =
            crypto.randomBytes(32).toString(
                'hex'
            );

        adminTokens.add(token);

        res.json({
            success: true,
            token
        });
    }
);

/* =========================================
   GET DATA
========================================= */

app.get('/api/data', (req, res) => {
    res.json(data);
});

/* =========================================
   SETTINGS
========================================= */

app.put(
    '/api/settings',
    requireAdmin,
    (req, res) => {
        data.settings = {
            name: clean(req.body.name),
            description: clean(
                req.body.description
            ),
            whatsapp: clean(
                req.body.whatsapp
            ),
            phone: clean(req.body.phone),
            email: clean(req.body.email),
            website: clean(
                req.body.website
            ),
            x: clean(req.body.x),
            announcement: clean(
                req.body.announcement
            )
        };

        saveData();

        res.json({
            success: true,
            settings: data.settings
        });
    }
);

/* =========================================
   ADD CATEGORY
========================================= */

app.post(
    '/api/categories',
    requireAdmin,
    (req, res) => {
        const name = clean(
            req.body.name
        );

        const icon =
            clean(req.body.icon) || '📦';

        if (!name) {
            return res.status(400).json({
                success: false,
                message:
                    'اسم التصنيف مطلوب'
            });
        }

        const category = {
            id: crypto.randomUUID(),
            name,
            icon
        };

        data.categories.push(category);

        saveData();

        res.json({
            success: true,
            category
        });
    }
);

/* =========================================
   EDIT CATEGORY
========================================= */

app.put(
    '/api/categories/:id',
    requireAdmin,
    (req, res) => {
        const category =
            data.categories.find(
                x =>
                    x.id ===
                    req.params.id
            );

        if (!category) {
            return res.status(404).json({
                success: false,
                message:
                    'التصنيف غير موجود'
            });
        }

        category.name =
            clean(req.body.name) ||
            category.name;

        category.icon =
            clean(req.body.icon) ||
            category.icon;

        saveData();

        res.json({
            success: true,
            category
        });
    }
);

/* =========================================
   DELETE CATEGORY
========================================= */

app.delete(
    '/api/categories/:id',
    requireAdmin,
    (req, res) => {
        const category =
            data.categories.find(
                x =>
                    x.id ===
                    req.params.id
            );

        if (!category) {
            return res.status(404).json({
                success: false,
                message:
                    'التصنيف غير موجود'
            });
        }

        const used =
            data.listings.some(
                listing =>
                    listing.categoryId ===
                    req.params.id
            );

        if (used) {
            return res.status(400).json({
                success: false,
                message:
                    'لا يمكن حذف تصنيف يحتوي على إعلانات'
            });
        }

        data.categories =
            data.categories.filter(
                x =>
                    x.id !==
                    req.params.id
            );

        saveData();

        res.json({
            success: true
        });
    }
);

/* =========================================
   ADD LISTING
========================================= */

app.post(
    '/api/listings',
    requireAdmin,
    upload.fields([
        {
            name: 'images',
            maxCount: 15
        },
        {
            name: 'video',
            maxCount: 1
        }
    ]),
   async (req, res) => {
    try {
            const body = req.body || {};
            const title = clean(
                body.title
            );

            const categoryId = clean(
                body.categoryId
            );

            if (!title || !categoryId) {
                return res.status(400).json({
                    success: false,
                    message:
                        'العنوان والتصنيف مطلوبان'
                });
            }

            const category =
                data.categories.find(
                    x =>
                        String(x.id) ===
                        String(categoryId)
                );

            if (!category) {
                return res.status(400).json({
                    success: false,
                    message:
                        'التصنيف غير موجود'
                });
            }

            const imageFiles = req.files?.images || [];

const images = (
    await Promise.all(
        imageFiles.map(async file => {
            const imageKitUrl =
                await uploadToImageKit(file);

            return (
                imageKitUrl ||
                `/uploads/${file.filename}`
            );
        })
    )
);

const videoFile =
    req.files?.video?.[0];

let videoUrl = '';

if (videoFile) {
    const imageKitVideoUrl =
        await uploadToImageKit(videoFile);

    videoUrl =
        imageKitVideoUrl ||
        `/uploads/${videoFile.filename}`;
}

            const listing = {
                id: crypto.randomUUID(),

                title,

                categoryId,

                price: clean(
                    req.body.price
                ),

                location: clean(
                    req.body.location
                ),

                whatsapp: clean(req.body.whatsapp),

                description: clean(
                    req.body.description
                ),

                images,

                video: videoUrl,

                published:
                    req.body.published !==
                    'false',

                createdAt:
                    new Date().toISOString(),

                updatedAt:
                    new Date().toISOString()
            };

            data.listings.unshift(
                listing
            );

            saveData();

            res.json({
                success: true,
                listing
            });
        } catch (err) {
            console.error(err);

            res.status(500).json({
                success: false,
                message:
                    'حدث خطأ أثناء إضافة الإعلان'
            });
        }
    }
);

/* =========================================
   EDIT LISTING
========================================= */

app.put(
    '/api/listings/:id',
    requireAdmin,
    upload.fields([
        {
            name: 'images',
            maxCount: 15
        },
        {
            name: 'video',
            maxCount: 1
        }
    ]),
    async (req, res) => {
        try {
            const listing =
                data.listings.find(
                    x =>
                        x.id ===
                        req.params.id
                );

            if (!listing) {
                return res.status(404).json({
                    success: false,
                    message:
                        'الإعلان غير موجود'
                });
            }

            const oldImages =
                Array.isArray(
                    listing.images
                )
                    ? listing.images
                    : [];

            const existingImages =
                normalizeImages(
                    req.body.existingImages
                );

            for (const oldImage of oldImages) {
                if (
                    !existingImages.includes(
                        oldImage
                    )
                ) {
                    deleteFileUrl(
                        oldImage
                    );
                }
            }

            const newImageFiles =
                req.files?.images || [];

            const newImages = (
                await Promise.all(
                    newImageFiles.map(
                        async file => {
                            const imageKitUrl =
                                await uploadToImageKit(file);

                            return (
                                imageKitUrl ||
                                `/uploads/${file.filename}`
                            );
                        }
                    )
                )
            );

            const finalImages = [
                ...existingImages,
                ...newImages
            ];

            const oldVideo =
                listing.video || '';

            const newVideoFile =
                req.files?.video?.[0];

            let finalVideo = clean(
                req.body.existingVideo
            );

            if (newVideoFile) {
                const imageKitVideoUrl =
                    await uploadToImageKit(
                        newVideoFile
                    );

                finalVideo =
                    imageKitVideoUrl ||
                    `/uploads/${newVideoFile.filename}`;

                if (
                    oldVideo &&
                    oldVideo !== finalVideo
                ) {
                    deleteFileUrl(
                        oldVideo
                    );
                }
            } else if (
                !finalVideo &&
                oldVideo
            ) {
                deleteFileUrl(
                    oldVideo
                );
            }

            listing.title =
                clean(req.body.title) ||
                listing.title;

            listing.categoryId =
                clean(
                    req.body.categoryId
                ) ||
                listing.categoryId;

            listing.price = clean(
                req.body.price
            );

            listing.location = clean(
                req.body.location
            );

            listing.whatsapp = clean(req.body.whatsapp);

            listing.description = clean(
                req.body.description
            );

            listing.images =
                finalImages;

            listing.video =
                finalVideo;

            listing.published =
                req.body.published !==
                'false';

            listing.updatedAt =
                new Date().toISOString();

            saveData();

            res.json({
                success: true,
                listing
            });
        } catch (err) {
            console.error(err);

            res.status(500).json({
                success: false,
                message:
                    'حدث خطأ أثناء تعديل الإعلان'
            });
        }
    }
);

/* =========================================
   DELETE LISTING
========================================= */

app.delete(
    '/api/listings/:id',
    requireAdmin,
    (req, res) => {
        const listing =
            data.listings.find(
                x =>
                    x.id ===
                    req.params.id
            );

        if (!listing) {
            return res.status(404).json({
                success: false,
                message:
                    'الإعلان غير موجود'
            });
        }

        for (
            const image of
            listing.images || []
        ) {
            deleteFileUrl(image);
        }

        if (listing.video) {
            deleteFileUrl(
                listing.video
            );
        }

        data.listings =
            data.listings.filter(
                x =>
                    x.id !==
                    req.params.id
            );

        saveData();

        res.json({
            success: true
        });
    }
);

/* =========================================
   MANIFEST / ICONS / OG
========================================= */

app.get(
    '/manifest.json',
    (req, res) => {
        res.sendFile(
            path.join(
                VISITOR_DIR,
                'manifest.json'
            )
        );
    }
);

app.get(
    '/icon-192.png',
    (req, res) => {
        res.sendFile(
            path.join(
                UPLOAD_DIR,
                'icon-192.png'
            )
        );
    }
);

app.get(
    '/icon-512.png',
    (req, res) => {
        res.sendFile(
            path.join(
                UPLOAD_DIR,
                'icon-512.png'
            )
        );
    }
);

app.get(
    '/og-image.jpg',
    (req, res) => {
        res.sendFile(
            path.join(
                UPLOAD_DIR,
                'og-image.jpg'
            )
        );
    }
);

/* =========================================
   SERVICE WORKER
========================================= */

app.get(
    '/sw.js',
    (req, res) => {
        res.sendFile(
            path.join(
                VISITOR_DIR,
                'sw.js'
            )
        );
    }
);

/* =========================================
   ADMIN PAGE
========================================= */

app.get(
    '/admin',
    (req, res) => {
        res.sendFile(
            path.join(
                ADMIN_DIR,
                'index.html'
            )
        );
    }
);

/* =========================================
   VISITOR PAGE
========================================= */

app.get(
    '/',
    (req, res) => {
        res.sendFile(
            path.join(
                VISITOR_DIR,
                'index.html'
            )
        );
    }
);

/* =========================================
   ERROR HANDLER
========================================= */

app.use(
    (err, req, res, next) => {
        if (
            err instanceof
            multer.MulterError
        ) {
            return res.status(400).json({
                success: false,
                message:
                    err.code ===
                    'LIMIT_FILE_SIZE'
                        ? 'حجم الملف كبير جداً'
                        : err.message
            });
        }

        if (err) {
            return res.status(400).json({
                success: false,
                message:
                    err.message ||
                    'حدث خطأ'
            });
        }

        next();
    }
);

/* =========================================
   START SERVER
========================================= */

async function startServer() {
    /*
       أولاً:
       نحاول جلب آخر نسخة من Firebase.
       إذا لم توجد بيانات، يتم رفع data.json الحالية.
    */

    await restoreFromFirebase();

    app.listen(
        PORT,
        () => {
            console.log('');
            console.log(
                '===================================='
            );
            console.log(
                '  INTERACTIVE EXHIBITION'
            );
            console.log(
                '===================================='
            );
            console.log(
                `  http://127.0.0.1:${PORT}`
            );
            console.log(
                `  Admin: http://127.0.0.1:${PORT}/admin`
            );
            console.log(
                '  Admin password: 123456'
            );
            console.log(
                `  Firebase: ${
                    firebaseEnabled
                        ? 'ENABLED'
                        : 'DISABLED'
                }`
            );
            console.log(
                '===================================='
            );
            console.log('');
        }
    );
}

if (require.main === module) {
    startServer().catch(err => {
        console.error('Server startup error:', err);
        app.listen(PORT, () => {
            console.log(`Server started on port ${PORT} using local data`);
        });
    });
} else {
    app.use((req, res, next) => {
        if (req.path.startsWith('/uploads/')) {
            return next();
        }
        next();
    });
}

module.exports = app;
