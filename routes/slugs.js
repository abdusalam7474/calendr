const express = require('express');
const router = express.Router();
const db = require('../config/db');

// @desc    Create a new slug with custom fields
// @route   POST /api/slugs
// @access  Protected
router.post('/', async (req, res) => {
    const adminId = req.admin.id;
    const { slug, fields } = req.body;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ message: 'Slug is required and can only contain lowercase letters, numbers, and hyphens.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check if slug already exists for this admin
        const [existing] = await connection.query('SELECT id FROM slugs WHERE admin_id = ? AND slug = ?', [adminId, slug]);
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'You already have a booking page with this slug.' });
        }

        // Create the slug
        const [result] = await connection.query('INSERT INTO slugs (admin_id, slug) VALUES (?, ?)', [adminId, slug]);
        const slugId = result.insertId;

        // Add the custom fields
        if (fields && fields.length > 0) {
            const fieldValues = fields.map(f => [slugId, f.field_name, f.field_label, f.field_type || 'text', f.is_required || false]);
            await connection.query('INSERT INTO slug_fields (slug_id, field_name, field_label, field_type, is_required) VALUES ?', [fieldValues]);
        }

        await connection.commit();
        res.status(201).json({ message: 'Booking page created successfully.', slugId, slug });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error creating slug:', error);
        res.status(500).json({ message: 'Server error while creating booking page.' });
    } finally {
        if (connection) connection.release();
    }
});

// @desc    Get all slugs for the logged-in admin
// @route   GET /api/slugs
// @access  Protected
router.get('/', async (req, res) => {
    const adminId = req.admin.id;
    try {
        const [slugs] = await db.query('SELECT id, slug, created_at FROM slugs WHERE admin_id = ?', [adminId]);
        res.json(slugs);
    } catch (error) {
        console.error('Error fetching slugs:', error);
        res.status(500).json({ message: 'Server error fetching booking pages.' });
    }
});

// @desc    Get a single slug and its fields
// @route   GET /api/slugs/:slugId
// @access  Protected
router.get('/:slugId', async (req, res) => {
    const adminId = req.admin.id;
    const { slugId } = req.params;

    try {
        const [slugs] = await db.query('SELECT * FROM slugs WHERE id = ? AND admin_id = ?', [slugId, adminId]);
        if (slugs.length === 0) {
            return res.status(404).json({ message: 'Booking page not found.' });
        }

        const [fields] = await db.query('SELECT id, field_name, field_label, field_type, is_required FROM slug_fields WHERE slug_id = ?', [slugId]);
        
        res.json({ ...slugs[0], fields });

    } catch (error) {
        console.error('Error fetching slug details:', error);
        res.status(500).json({ message: 'Server error fetching booking page details.' });
    }
});

// @desc    Update a slug and its fields
// @route   PUT /api/slugs/:slugId
// @access  Protected
router.put('/:slugId', async (req, res) => {
    const adminId = req.admin.id;
    const { slugId } = req.params;
    const { slug, fields } = req.body;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ message: 'Slug is required and must be valid.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check ownership and if new slug name is available
        const [slugs] = await connection.query('SELECT id FROM slugs WHERE id = ? AND admin_id = ?', [slugId, adminId]);
        if (slugs.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Booking page not found.' });
        }
        
        const [existing] = await connection.query('SELECT id FROM slugs WHERE admin_id = ? AND slug = ? AND id != ?', [adminId, slug, slugId]);
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'You already have another booking page with this slug.' });
        }

        // Update slug
        await connection.query('UPDATE slugs SET slug = ? WHERE id = ?', [slug, slugId]);

        // Easiest way to update fields is to delete old and insert new
        await connection.query('DELETE FROM slug_fields WHERE slug_id = ?', [slugId]);
        if (fields && fields.length > 0) {
            const fieldValues = fields.map(f => [slugId, f.field_name, f.field_label, f.field_type || 'text', f.is_required || false]);
            await connection.query('INSERT INTO slug_fields (slug_id, field_name, field_label, field_type, is_required) VALUES ?', [fieldValues]);
        }

        await connection.commit();
        res.json({ message: 'Booking page updated successfully.' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating slug:', error);
        res.status(500).json({ message: 'Server error while updating booking page.' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;