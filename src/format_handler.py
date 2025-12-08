import json
import os
import boto3
import time
from google import genai
from botocore.exceptions import ClientError # <-- Add this for error handling

# Initialize AWS clients
DYNAMODB = boto3.resource('dynamodb')
S3 = boto3.client('s3')
SECRETS_MANAGER_CLIENT = boto3.client('secretsmanager') # <-- New Boto3 client

METADATA_TABLE_NAME = os.environ.get('METADATA_TABLE')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET')
# Retrieve ARN from environment variable (set in template.yaml)
GEMINI_SECRET_ARN = os.environ.get('GEMINI_SECRET_ARN') 

def get_cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': '*'
    }

# --- Function to retrieve the API key using native Boto3 SDK (Runs once on cold start) ---
def get_gemini_api_key():
    """Retrieves the Gemini API Key directly from AWS Secrets Manager using Boto3."""
    if not GEMINI_SECRET_ARN:
        return None
        
    try:
        # Direct SDK call to get the secret value
        secret_value = SECRETS_MANAGER_CLIENT.get_secret_value(SecretId=GEMINI_SECRET_ARN)['SecretString']
        
        # We stored the secret as a JSON key/value pair
        secret_dict = json.loads(secret_value)
        return secret_dict.get('GEMINI_API_KEY')
        
    except ClientError as e:
        print(f"FATAL: Could not retrieve secret {GEMINI_SECRET_ARN}: {e}")
        return None

# Retrieve key once during Lambda initialization
GEMINI_API_KEY = get_gemini_api_key()

# ----------------------------------------------------------------------
# The rest of your lambda_handler function remains the same. 
# You can remove the 'requests' import from requirements.txt now.

# ----------------------------------------------------------------------

def lambda_handler(event, context):
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': '' # Empty body is fine for preflight
        }
    """Handles the POST /format/{key} request using Gemini 1.5 Flash."""
    
    table = DYNAMODB.Table(METADATA_TABLE_NAME)
    # Key is expected to be in the path parameter
    access_key = event['pathParameters']['key'].upper() 
    
    if not GEMINI_API_KEY:
        return {'statusCode': 500,'headers': get_cors_headers(), 'body': json.dumps({'error': 'AI Service key missing or retrieval failed.'})}
    
    try:
        # 1. Look up original metadata and content location
        response = table.get_item(Key={'AccessKey': access_key})
        item = response.get('Item')
        if not item:
            return {'statusCode': 404,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Item not found.'})}
            
        original_s3_key = item.get('TextS3Key')
        
        # 2. Retrieve original content from S3
        s3_response = S3.get_object(Bucket=S3_BUCKET_NAME, Key=original_s3_key)
        raw_content = s3_response['Body'].read().decode('utf-8')
        
        # --- 3. Call Gemini API for Formatting ---
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        prompt = f"""
        You are an intelligent text and code formatter for a secure storage service. Your sole purpose is to clean, align, and organize the user's provided content while strictly preserving its original meaning and characters.

        Rules for Formatting:
        1.  **Strict Preservation:** Do not omit, change, or add any functional characters, variables, or logic.
        2.  **Prose/Text:** If the content is prose or text, re-align paragraphs, fix erratic spacing, apply proper capitalization (start of sentence), and insert necessary punctuation (periods, commas) only where clearly intended, making the text flow naturally. Use double line breaks to clearly separate paragraphs.
        3.  **Code/Scripts:** If the content is code, detect the language (e.g., Python, JavaScript, YAML, etc.). Enclose the entire block in a fenced Markdown code block, including the language identifier (e.g., ```python\n...\n```). Apply proper indentation and standard code styling.
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
        
        formatted_content = gemini_response.text.strip()
        
        # 4. Save Formatted Content to S3 (NEW, separate file for zero data loss)
        formatted_s3_key = f"{access_key}/formatted_{int(time.time())}.md"
        
        S3.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=formatted_s3_key,
            Body=formatted_content.encode('utf-8'),
            ContentType='text/markdown'
        )

        # 5. Update DynamoDB Metadata with the location of the formatted content
        table.update_item(
            Key={'AccessKey': access_key},
            UpdateExpression="SET FormattedS3Key = :fsk, IsFormatted = :t",
            ExpressionAttributeValues={
                ':fsk': formatted_s3_key,
                ':t': True
            }
        )
        
        # 6. Return Success
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'message': 'Content formatted by Gemini 2.5 Flash and saved.',
                'original_key': access_key,
                'new_formatted_s3_key': formatted_s3_key,
                'tokens_used': gemini_response.usage_metadata.prompt_token_count,
            })
        }

    except Exception as e:
        print(f"Error during Gemini formatting: {e}")
        # Ensures that if the AI call fails, the original data is still safe in S3.
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': f'AI formatting failed. Original data is safe: {str(e)}'})
        }