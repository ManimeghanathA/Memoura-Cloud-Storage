# retrieve_handler.py (COMPLETE replacement)
import json
import os
import time
from decimal import Decimal
import json.encoder
import boto3
import hashlib
from botocore.config import Config
from botocore.exceptions import ClientError

# Initialize AWS clients
DYNAMODB = boto3.resource('dynamodb')
# Use s3v4 for modern, secure presigned URLs
S3 = boto3.client('s3', config=Config(signature_version='s3v4'))

METADATA_TABLE_NAME = os.environ.get('METADATA_TABLE')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET')

def get_cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': '*'
    }

# Custom JSON encoder to handle DynamoDB's Decimal type
class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            # Convert Decimal type to integer for epoch timestamps
            return int(o)
        return super(DecimalEncoder, self).default(o)

def lambda_handler(event, context):
    """Handles retrieval, password check, and returns content or a download link."""
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': '' # Empty body is fine for preflight
        }
    
    table = DYNAMODB.Table(METADATA_TABLE_NAME)
    
    access_key = 'UNKNOWN' 
    
    try:
        # 1. Get Key and Retrieval Preferences
        access_key = event['pathParameters']['key'].upper()
        
        query_params = event.get('queryStringParameters') or {}
        force_raw = query_params.get('raw', 'false').lower() == 'true'
        
        # 2. Look up Metadata in DynamoDB
        response = table.get_item(Key={'AccessKey': access_key})
        item = response.get('Item')

        if not item:
            return {'statusCode': 404,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Data not found or already expired.'})}

        # 3. Handle Password Check
        stored_hash = item.get('PasswordHash')
        if stored_hash:
            provided_password = json.loads(event.get('body', '{}')).get('password')
            
            if not provided_password:
                return {'statusCode': 401,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Password required to access this item.'})}
                
            provided_hash = hashlib.sha256(provided_password.encode('utf-8')).hexdigest()
            
            if provided_hash != stored_hash:
                return {'statusCode': 401,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Invalid password.'})}

        # 4. Handle One-Time Access (The Auto-Delete Feature)
        if item.get('AccessMode') == 'ONE_TIME':
            table.delete_item(Key={'AccessKey': access_key})
            
        # --- 5. Determine Content Source (Text Content and File URL) ---
        
        final_response_body = {
            'key': access_key,
            'upload_mode': item['UploadMode'],
            'expires': item['ExpiryTimestamp'],
        }
        
        # A. Handle Text/Code Content Retrieval (If TextS3Key exists)
        if item.get('TextS3Key'):
            original_key = item.get('TextS3Key')
            formatted_key = item.get('FormattedS3Key')
            
            key_to_retrieve = original_key if (force_raw or not formatted_key) else formatted_key 
            
            try:
                s3_response = S3.get_object(
                    Bucket=S3_BUCKET_NAME,
                    Key=key_to_retrieve
                )
                text_content = s3_response['Body'].read().decode('utf-8')
                final_response_body['content'] = text_content
            except ClientError as e:
                print(f"Warning: Text S3 object missing or access denied for key {key_to_retrieve}: {e}")
                
        # B. Handle Multiple File Retrieval (If Files list exists)
        files_to_download = []
        if item.get('Files'): # Checks for the new 'Files' attribute (List of Maps)
            
            for file_info in item['Files']:
                s3_key = file_info['s3_key']
                filename = file_info['filename']
                
                # Generate Presigned GET URL for EACH file
                download_url = S3.generate_presigned_url(
                    ClientMethod='get_object',
                    Params={'Bucket': S3_BUCKET_NAME, 'Key': s3_key},
                    ExpiresIn=3600
                )
                
                files_to_download.append({
                    'filename': filename,
                    'download_url': download_url
                })
        
        # Add the list of files to the response body
        if files_to_download:
            final_response_body['files'] = files_to_download # NEW: Array of file objects
            final_response_body['message'] = 'Authorization successful. Content retrieved.'
            
        
        # C. Return the consolidated response
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(final_response_body, cls=DecimalEncoder)
        }

    except Exception as e:
        print(f"FATAL: Unhandled Error during retrieval for key {access_key}: {e}")
        return {'statusCode': 500,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Internal server error during retrieval.'})}