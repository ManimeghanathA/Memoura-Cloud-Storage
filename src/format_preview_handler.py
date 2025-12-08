# src/format_preview_handler.py
import json
import os
import boto3
import time
from google import genai
from botocore.exceptions import ClientError
from decimal import Decimal

# Initialize AWS clients
DYNAMODB = boto3.resource('dynamodb')
S3 = boto3.client('s3')
SECRETS_MANAGER_CLIENT = boto3.client('secretsmanager')

METADATA_TABLE_NAME = os.environ.get('METADATA_TABLE')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET')
GEMINI_SECRET_ARN = os.environ.get('GEMINI_SECRET_ARN') 

# --- Constants for Cache Prefix and Expiration ---
CACHE_PREFIX = "cache/"
CACHE_RAW_FILENAME = "raw.txt"
CACHE_FORMATTED_FILENAME = "formatted.md"
PRESIGNED_URL_EXPIRY = 900 # 15 minutes for cache link validity

def get_cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': '*'
    }

def get_gemini_api_key():
    """Retrieves the Gemini API Key directly from AWS Secrets Manager."""
    if not GEMINI_SECRET_ARN: return None
    try:
        secret_value = SECRETS_MANAGER_CLIENT.get_secret_value(SecretId=GEMINI_SECRET_ARN)['SecretString']
        secret_dict = json.loads(secret_value)
        return secret_dict.get('GEMINI_API_KEY')
    except ClientError as e:
        print(f"FATAL: Could not retrieve secret {GEMINI_SECRET_ARN}: {e}")
        return None

GEMINI_API_KEY = get_gemini_api_key()

def get_formatted_content(raw_content, client):
    """Helper function to call Gemini with the improved, strict formatting prompt."""
    
    prompt = f"""
You are an intelligent text and code formatter for a secure storage service. Your sole purpose is to clean, align, and organize the user's provided content while strictly preserving its original meaning and characters.

Rules for Formatting:
1.  **Strict Preservation:** Do not omit, change, or add any functional characters, variables, or logic.
2.  **Prose/Text:** If the content is prose or text, re-align paragraphs, fix erratic spacing, apply proper capitalization (start of sentence), and insert necessary punctuation (periods, commas) only where clearly intended, making the text flow naturally. Use double line breaks to clearly separate paragraphs.
3.  **Code/Scripts:** If the content is code, detect the language and enclose the entire block in a fenced Markdown code block, including the language identifier (e.g., ```python\n...\n```). Apply proper indentation and standard code styling.
4.  **Output:** Return **ONLY** the single, formatted Markdown text result. Do not add any conversational introductions, summaries, or context.

USER CONTENT START:
---
{raw_content}
---
"""
    
    gemini_response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt
    )
    
    return gemini_response.text.strip()

def lambda_handler(event, context):
    """
    Handles POST /format-preview/{key}. Saves raw/formatted content to S3 cache 
    and returns Presigned URLs for preview.
    """
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return { 'statusCode': 200, 'headers': get_cors_headers(), 'body': '' }
    
    if not GEMINI_API_KEY:
        return {'statusCode': 500, 'headers': get_cors_headers(), 'body': json.dumps({'error': 'AI Service key missing or retrieval failed.'})}
    
    try:
        # 1. Get Key and Raw Content from the Request
        access_key = event['pathParameters']['key'].upper() 
        body = json.loads(event.get('body', '{}'))
        raw_content = body.get('content')
        
        if not raw_content:
            return {'statusCode': 400, 'headers': get_cors_headers(), 'body': json.dumps({'error': 'Missing text content for formatting.'})}

        # --- 2. Generate Unique Cache Keys ---
        # Use access key + timestamp for a unique sub-directory per user session (30 min window)
        session_timestamp = str(int(time.time()))
        cache_session_prefix = f"{CACHE_PREFIX}{access_key}/{session_timestamp}/"
        
        raw_s3_key = cache_session_prefix + CACHE_RAW_FILENAME
        formatted_s3_key = cache_session_prefix + CACHE_FORMATTED_FILENAME

        # --- 3. Save Raw Content to S3 Cache ---
        S3.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=raw_s3_key,
            Body=raw_content.encode('utf-8'),
            ContentType='text/plain'
        )

        # --- 4. Call Gemini API and Save Formatted Content to S3 Cache ---
        client = genai.Client(api_key=GEMINI_API_KEY)
        formatted_content = get_formatted_content(raw_content, client)
        
        S3.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=formatted_s3_key,
            Body=formatted_content.encode('utf-8'),
            ContentType='text/markdown'
        )
        
        # --- 5. Generate Presigned GET URLs for Client Preview ---
        raw_download_url = S3.generate_presigned_url(
            ClientMethod='get_object',
            Params={'Bucket': S3_BUCKET_NAME, 'Key': raw_s3_key},
            ExpiresIn=PRESIGNED_URL_EXPIRY
        )

        formatted_download_url = S3.generate_presigned_url(
            ClientMethod='get_object',
            Params={'Bucket': S3_BUCKET_NAME, 'Key': formatted_s3_key},
            ExpiresIn=PRESIGNED_URL_EXPIRY
        )
        
        # --- 6. Return Cache Pointers and URLs to Client ---
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'message': 'Content formatted and cached for preview.',
                'key': access_key,
                # New pointers for the final store step in Phase 3
                'cache_raw_key': raw_s3_key,
                'cache_formatted_key': formatted_s3_key,
                # URLs for immediate client preview
                'raw_preview_url': raw_download_url,
                'formatted_preview_url': formatted_download_url
            })
        }

    except Exception as e:
        print(f"Error during AI formatting preview: {e}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': f'AI formatting failed: {str(e)}'})
        }