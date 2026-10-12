ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

UPDATE products SET description = CASE sku
	WHEN 'APL-16P' THEN 'Tela Super Retina XDR de 6,3 polegadas, chip A18 Pro e sistema de câmeras avançado. Produto novo, lacrado e com garantia Apple.'
	WHEN 'SAM-S25U' THEN 'Smartphone premium com tela ampla, S Pen integrada e recursos Galaxy AI. Produto novo, lacrado e com garantia de fábrica.'
	WHEN 'APL-15' THEN 'Tela Super Retina XDR de 6,1 polegadas, câmera principal de 48 MP e conexão USB-C. Aparelho revisado e pronto para uso.'
	WHEN 'GOO-P9P' THEN 'Câmeras Pixel com processamento inteligente, tela LTPO OLED e recursos de IA do Google. Aparelho desbloqueado e revisado.'
	ELSE CASE name
		WHEN 'iPhone 16 Pro' THEN 'Tela Super Retina XDR de 6,3 polegadas, chip A18 Pro e sistema de câmeras avançado. Produto novo, lacrado e com garantia Apple.'
		WHEN 'Galaxy S25 Ultra' THEN 'Smartphone premium com tela ampla, S Pen integrada e recursos Galaxy AI. Produto novo, lacrado e com garantia de fábrica.'
		WHEN 'iPhone 15' THEN 'Tela Super Retina XDR de 6,1 polegadas, câmera principal de 48 MP e conexão USB-C. Aparelho revisado e pronto para uso.'
		WHEN 'Pixel 9 Pro' THEN 'Câmeras Pixel com processamento inteligente, tela LTPO OLED e recursos de IA do Google. Aparelho desbloqueado e revisado.'
		ELSE description
	END
END
WHERE description = '' AND (sku IN ('APL-16P', 'SAM-S25U', 'APL-15', 'GOO-P9P') OR name IN ('iPhone 16 Pro', 'Galaxy S25 Ultra', 'iPhone 15', 'Pixel 9 Pro'));