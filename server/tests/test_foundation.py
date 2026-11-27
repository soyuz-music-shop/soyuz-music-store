import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

class FoundationTests(unittest.TestCase):
    def test_sales_off(self):
        c = TestClient(app)
        self.assertFalse(c.get('/health/live').json()['sales_enabled'])
        self.assertEqual(c.post('/api/v1/orders', json={}).status_code, 404)
        self.assertEqual(c.get('/docs').status_code, 404)
        page = c.get('/')
        self.assertIn('Предварительный просмотр', page.text)
        self.assertNotIn('auth-config.js', page.text)
        self.assertEqual(c.get('/assets/styles.css').status_code, 200)
        self.assertEqual(c.get('/assets/hero-new-shelf.webp').status_code, 200)
        self.assertEqual(c.get('/products.json').status_code, 404)
        self.assertEqual(c.get('/auth-config.js').status_code, 404)
        self.assertEqual(c.get('/api/v1/orders').status_code, 404)
        self.assertIn("connect-src 'none'", page.headers['Content-Security-Policy'])
    def test_ready(self):
        c = TestClient(app)
        with patch('app.main.readiness', return_value=True):
            self.assertEqual(c.get('/health/ready').status_code, 200)
        with patch('app.main.readiness', return_value=False):
            self.assertEqual(c.get('/health/ready').status_code, 503)

if __name__ == '__main__':
    unittest.main()
