-- Viewer site superfan applications are auto-approved on submit; clear legacy staff queue.

UPDATE viewer_superfan_site_applications
SET status = 'approved',
    reviewed_at = COALESCE(reviewed_at, now()),
    updated_at = now()
WHERE status = 'pending';

COMMENT ON TABLE viewer_superfan_site_applications IS
  'Viewers register for fan boards here (auto-approved). Streamers approve per-channel in viewer_streamer_superfan_memberships.';
