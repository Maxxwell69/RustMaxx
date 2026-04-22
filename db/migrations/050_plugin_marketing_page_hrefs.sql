-- Link plugin directory rows to dedicated marketing pages.

UPDATE plugin_directory SET marketing_href = '/basebotch' WHERE slug = 'basebotch';
UPDATE plugin_directory SET marketing_href = '/rustchaos' WHERE slug = 'rustchaos';
UPDATE plugin_directory SET marketing_href = '/maxxraiders' WHERE slug = 'maxxraiders';
