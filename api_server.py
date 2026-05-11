from flask import Flask, request, jsonify
from flask_cors import CORS
import openai
import google.generativeai as genai
import base64
import uuid
import os
import json

app = Flask(__name__)
CORS(app, supports_credentials=True, origins='*')

# 创建文件存储目录
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

# API Keys存储文件
API_KEYS_FILE = os.path.join(DATA_DIR, 'api_keys.json')

# API模型配置
GEMINI_MODEL_MAP = {
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-3.1-pro': 'gemini-3.1-pro-preview',
    'imagen-4': 'imagen-4.0-generate-002',
    'imagen-4-ultra': 'imagen-4.0-ultra-generate-preview',
    'imagen-4-fast': 'imagen-4.0-fast-generate-preview',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
    'gemini-1.0-pro': 'gemini-1.0-pro',
}

@app.route('/api/keys', methods=['GET'])
def get_api_keys():
    """获取已保存的API Keys"""
    try:
        if os.path.exists(API_KEYS_FILE):
            with open(API_KEYS_FILE, 'r', encoding='utf-8') as f:
                keys = json.load(f)
            return jsonify({
                'success': True,
                'keys': keys
            })
        else:
            return jsonify({
                'success': True,
                'keys': {
                    'google': '',
                    'openai': ''
                }
            })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to read API keys: {str(e)}'
        })

@app.route('/api/keys', methods=['POST'])
def save_api_keys_route():
    """保存API Keys"""
    try:
        data = request.get_json()
        keys = {
            'google': data.get('google', ''),
            'openai': data.get('openai', '')
        }
        with open(API_KEYS_FILE, 'w', encoding='utf-8') as f:
            json.dump(keys, f)
        return jsonify({
            'success': True,
            'message': 'API Keys saved'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to save API keys: {str(e)}'
        })

def get_gemini_model_name(model_id: str) -> str:
    """获取Gemini模型名称映射"""
    return GEMINI_MODEL_MAP.get(model_id, 'gemini-2.5-flash')

@app.route('/api/generate', methods=['OPTIONS'])
def generate_options():
    """处理CORS预检请求"""
    response = jsonify({'message': 'OK'})
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
    response.headers.add('Access-Control-Allow-Methods', 'POST')
    return response

@app.route('/api/generate', methods=['POST'])
def generate():
    """处理图片生成请求"""
    try:
        request_data = request.get_json()
        
        prompt = request_data.get('prompt', '')
        model = request_data.get('model', 'seedream')
        size = request_data.get('size', '1K')
        output_count = request_data.get('outputCount', 1)
        api_key = request_data.get('apiKey', '')
        
        if not prompt:
            return jsonify({
                'success': False,
                'error': 'Please enter a prompt'
            })
        
        images = []
        
        # Gemini/Imagen 模型
        if model.startswith('gemini') or model.startswith('imagen'):
            if not api_key:
                return jsonify({
                    'success': False,
                    'error': 'Please configure Google API Key',
                    'requiresApiKey': True,
                    'apiKeyType': 'Google',
                    'modelName': model
                })
            
            try:
                model_name = get_gemini_model_name(model)
                
                # Imagen 模型
                if model.startswith('imagen'):
                    try:
                        import vertexai
                        from vertexai.preview import generative_models
                        
                        # 使用环境变量或默认项目
                        project_id = os.environ.get('GOOGLE_CLOUD_PROJECT', 'gen-lang-client-xxxxx')
                        vertexai.init(project=project_id, location="us-central1")
                        
                        for i in range(min(output_count, 4)):
                            response = generative_models.ImageGenerationModel.from_pretrained(model_name).generate_images(
                                prompt=prompt,
                                number_of_images=1,
                            )
                            
                            if response.images:
                                img_base64 = base64.b64encode(response.images[0]._image_bytes).decode('utf-8')
                                img_url = f"data:image/png;base64,{img_base64}"
                                
                                images.append({
                                    'id': f"imagen-{uuid.uuid4().hex[:8]}",
                                    'url': img_url,
                                    'prompt': prompt,
                                    'originalPrompt': prompt,
                                    'category': 'general',
                                    'style': 'auto',
                                    'model': model
                                })
                        
                        if images:
                            return jsonify({
                                'success': True,
                                'images': images
                            })
                        else:
                            return jsonify({
                                'success': False,
                                'error': 'Imagen image generation failed. No images returned.'
                            })
                    except ImportError:
                        return jsonify({
                            'success': False,
                            'error': 'Vertex AI SDK is required for Imagen. Please install: pip install vertexai google-cloud-aiplatform'
                        })
                
                # Gemini 模型
                else:
                    genai.configure(api_key=api_key)
                    model_obj = genai.GenerativeModel(model_name)
                    
                    for i in range(min(output_count, 4)):
                        response = model_obj.generate_content(prompt)
                        
                        # 处理响应
                        if hasattr(response, 'parts') and response.parts:
                            for part in response.parts:
                                if hasattr(part, 'image') and part.image:
                                    image_data = part.image
                                    if hasattr(image_data, 'image_bytes'):
                                        try:
                                            # image_bytes可能是属性或方法
                                            img_bytes = image_data.image_bytes
                                            if callable(img_bytes):
                                                img_bytes = img_bytes()
                                            img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                                            img_url = f"data:image/png;base64,{img_base64}"
                                            
                                            images.append({
                                                'id': f"gemini-{uuid.uuid4().hex[:8]}",
                                                'url': img_url,
                                                'prompt': prompt,
                                                'originalPrompt': prompt,
                                                'category': 'general',
                                                'style': 'auto',
                                                'model': model
                                            })
                                        except Exception as e:
                                            print(f"Error processing image: {e}")
                                    elif hasattr(image_data, 'uri'):
                                        images.append({
                                            'id': f"gemini-{uuid.uuid4().hex[:8]}",
                                            'url': image_data.uri,
                                            'prompt': prompt,
                                            'originalPrompt': prompt,
                                            'category': 'general',
                                            'style': 'auto',
                                            'model': model
                                        })
                                elif hasattr(part, 'text') and part.text:
                                    # 文本响应（某些Gemini模型返回文本而非图片）
                                    images.append({
                                        'id': f"gemini-{uuid.uuid4().hex[:8]}",
                                        'url': '',
                                        'prompt': prompt,
                                        'originalPrompt': prompt,
                                        'category': 'general',
                                        'style': 'auto',
                                        'model': model,
                                        'text': part.text
                                    })
                        
                        elif hasattr(response, 'text') and response.text:
                            # 直接文本响应
                            images.append({
                                'id': f"gemini-{uuid.uuid4().hex[:8]}",
                                'url': '',
                                'prompt': prompt,
                                'originalPrompt': prompt,
                                'category': 'general',
                                'style': 'auto',
                                'model': model,
                                'text': response.text
                            })
                    
                    if images:
                        return jsonify({
                            'success': True,
                            'images': images
                        })
                    else:
                        return jsonify({
                            'success': False,
                            'error': 'Gemini returned no images. Please check if the model supports image generation.'
                        })
            except Exception as e:
                print(f"Gemini API Error: {str(e)}")
                return jsonify({
                    'success': False,
                    'error': f'Gemini API Error: {str(e)}',
                    'networkError': True
                })
        
        # DALL-E 模型
        elif model.startswith('dall-e'):
            if not api_key:
                return jsonify({
                    'success': False,
                    'error': 'Please configure OpenAI API Key',
                    'requiresApiKey': True,
                    'apiKeyType': 'OpenAI',
                    'modelName': model
                })
            
            try:
                client = openai.OpenAI(api_key=api_key)
                
                # 处理size
                size_map = {
                    '1K': '1024x1024',
                    '2K': '1024x1792',
                    '4K': '1792x1024'
                }
                image_size = size_map.get(size, '1024x1024')
                
                for i in range(min(output_count, 4)):
                    response = client.images.generate(
                        model=model,
                        prompt=prompt,
                        n=1,
                        size=image_size,
                        quality='standard'
                    )
                    
                    if response.data:
                        images.append({
                            'id': f"dalle-{uuid.uuid4().hex[:8]}",
                            'url': response.data[0].url,
                            'prompt': prompt,
                            'originalPrompt': prompt,
                            'category': 'general',
                            'style': 'auto',
                            'model': model
                        })
                
                if images:
                    return jsonify({
                        'success': True,
                        'images': images
                    })
                else:
                    return jsonify({
                        'success': False,
                        'error': 'DALL-E image generation failed. No images returned.'
                    })
            except Exception as e:
                print(f"OpenAI API Error: {str(e)}")
                return jsonify({
                    'success': False,
                    'error': f'OpenAI API Error: {str(e)}',
                    'networkError': True
                })
        
        # 不支持的模型
        else:
            return jsonify({
                'success': False,
                'error': f'Model {model} is not supported by local API server'
            })
    
    except Exception as e:
        print(f"Server Error: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Server Error: {str(e)}'
        })

if __name__ == '__main__':
    print("=" * 50)
    print("     WujieAI API Server")
    print("=" * 50)
    print("Server running at: http://localhost:5001")
    print("API endpoint: http://localhost:5001/api/generate")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5001, debug=False)
