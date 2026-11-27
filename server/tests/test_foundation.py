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
        self.assertIn('M314', c.get('/').text)
    def test_ready(self):
        c = TestClient(app)
        with patch('app.main.readiness', return_value=True):
            self.assertEqual(c.get('/health/ready').status_code, 200)
        with patch('app.main.readiness', return_value=False):
            self.assertEqual(c.get('/health/ready').status_code, 503)

if __name__ == '__main__':
    unittest.main()
