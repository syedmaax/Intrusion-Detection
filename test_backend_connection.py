#!/usr/bin/env python3
"""
Quick Backend Connection Test
"""

import requests
import sys

print('🔍 Testing Backend Connection...')
try:
    response = requests.get('http://localhost:5000/health', timeout=5)
    if response.status_code == 200:
        print('✅ Backend is running!')
        data = response.json()
        print('📊 Health check response:', data)
    else:
        print('❌ Backend returned status:', response.status_code)
        sys.exit(1)
except Exception as e:
    print('❌ Cannot connect to backend:', str(e))
    print('💡 Make sure start_backend.bat is running')
    sys.exit(1)

print('\n🎉 Backend is working! Now open your browser to:')
print('🌐 http://localhost:5000/frontend/index.html')
print('   or use: start_frontend.bat')