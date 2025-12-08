import json
import os
import time
import boto3
import hashlib
from botocore.config import Config
from decimal import Decimal
from botocore.exceptions import ClientError

DYNAMODB = boto3.resource('dynamodb')
S3 = boto3.client('s3', config=Config(signature_version='s3v4'))

METADATA_TABLE_NAME = os.environ.get('METADATA_TABLE')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET')
S3_COPY_SOURCE = {'Bucket': S3_BUCKET_NAME, 'Key': None}

def get_cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': '*'
    }

def calculate_expiry_time(lifetime_days):
    """
    CRITICAL ACCURACY FIX: Translates the imprecise fractional day input into 
    a precise number of seconds, then calculates and rounds the epoch time.
    """
    # Map of frontend input (days, potentially imprecise float) to the precise duration in seconds.
    # This ensures "0.0007" is exactly 60 seconds, eliminating floating-point errors.
    PRECISE_DURATION_MAP = {
        0.0007: 60, # Maps the 1-minute input to exactly 60 seconds
        1.0: 1 * 86400,
        3.0: 3 * 86400,
        7.0: 7 * 86400,
        30.0: 30 * 86400,
    }
    
    # Ensure lifetime_days is a float before checking the map
    lifetime_days_float = float(lifetime_days)

    # Use the precise duration from the map, falling back to the formula
    duration_in_seconds = PRECISE_DURATION_MAP.get(
        lifetime_days_float, 
        lifetime_days_float * 86400
    )
    
    # Calculate the future time and ensure it is a clean integer second.
    future_time_float = time.time() + duration_in_seconds
    
    # Rounding is critical for DDB TTL acceptance.
    return int(round(future_time_float)) 


def cleanup_cache_files(cache_raw_key, cache_formatted_key):
    """Deletes the temporary raw and formatted files from S3 cache."""
    print(f"Starting cleanup for cache files.")
    keys_to_delete = []
    if cache_raw_key:
        keys_to_delete.append({'Key': cache_raw_key})
    if cache_formatted_key:
        keys_to_delete.append({'Key': cache_formatted_key})

    if keys_to_delete:
        S3.delete_objects(
            Bucket=S3_BUCKET_NAME,
            Delete={'Objects': keys_to_delete}
        )
        print(f"Successfully deleted {len(keys_to_delete)} cache objects.")
    else:
        print("No cache keys provided for cleanup.")

def lambda_handler(event, context):
    """Handles the final commit (S3 Copy/DynamoDB Put) using cached or direct content."""
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return { 'statusCode': 200, 'headers': get_cors_headers(), 'body': '' }
    
    table = DYNAMODB.Table(METADATA_TABLE_NAME)
    
    # Initialize cache keys for final cleanup in case of failure
    cache_raw_key = None
    cache_formatted_key = None 
    permanent_s3_key = None # Initialize for conflict cleanup

    try:
        if not event.get('body'):
            return {'statusCode': 400,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Missing request body.'})}
            
        body = json.loads(event['body'])
        
        # --- 1. Extract Core Inputs & S3 Cache Pointers ---
        custom_key_input = body.get('custom_key')
        filenames = body.get('filenames', []) 
        upload_mode = body.get('upload_mode', 'HYBRID').upper()
        
        # NEW: Cache Keys from the Frontend
        s3_source_key = body.get('s3_source_key') # S3 Path for S3 Copy (if cached)
        direct_content_data = body.get('content') # Raw content for direct S3 Put (if not cached)
        cache_raw_key = body.get('cache_raw_key')
        cache_formatted_key = body.get('cache_formatted_key')
        
        if not custom_key_input:
            return {'statusCode': 400, 'headers': get_cors_headers(), 'body': json.dumps({'error': 'Custom key is required.'})}

        access_key = custom_key_input.upper() 

        # FIX: Explicitly retrieve lifetime_days as a float
        lifetime_days = float(body.get('lifetime_days', 1))
        
        access_mode = body.get('access_mode', 'OPEN').upper()
        password = body.get('password')
        password_hash = hashlib.sha256(password.encode('utf-8')).hexdigest() if password else None

        # --- 2. ENFORCE CONSTRAINTS ---
        has_s3_source = s3_source_key is not None
        has_direct_content = direct_content_data is not None
        has_files = len(filenames) > 0
        
        has_text_component = has_s3_source or has_direct_content

        if upload_mode == 'TEXT' and has_files:
            return {'statusCode': 400,'headers': get_cors_headers(), 'body': json.dumps({'error': 'TEXT mode does not permit file uploads.'})}
        if upload_mode != 'TEXT' and not (has_text_component or has_files):
             return {'statusCode': 400,'headers': get_cors_headers(), 'body': json.dumps({'error': 'Missing content or file for selected mode.'})}


        # --- 3. Prep Metadata ---
        # FIX: Use the robust calculation function which guarantees an integer epoch time
        expiry_time_epoch = calculate_expiry_time(lifetime_days)
        
        item_to_save = {
            'AccessKey': access_key, 'UploadMode': upload_mode, 'AccessMode': access_mode,
            'CreationTime': Decimal(int(time.time())),
            'ExpiryTimestamp': Decimal(expiry_time_epoch), # CRITICAL: Now guaranteed integer value
            'IsFormatted': False 
        }
        if password_hash: item_to_save['PasswordHash'] = password_hash
        
        
        # --- 4. HANDLE TEXT/CODE CONTENT (S3 Commit) ---
        if has_text_component:
            permanent_s3_key = f"{access_key}/content.txt"
            item_to_save['TextS3Key'] = permanent_s3_key
            
            if has_s3_source:
                # PATH 1: Content came from the AI cache (S3 Copy Operation)
                print(f"COMMITTING from cache key: {s3_source_key}")
                copy_source = {'Bucket': S3_BUCKET_NAME, 'Key': s3_source_key}
                
                S3.copy_object(
                    Bucket=S3_BUCKET_NAME,
                    CopySource=copy_source,
                    Key=permanent_s3_key # Final S3 Key
                )
                
            elif has_direct_content:
                # PATH 2: Content came directly from the user (Direct S3 Write Operation - FIX)
                print("COMMITTING direct content from request body.")
                S3.put_object(
                    Bucket=S3_BUCKET_NAME, 
                    Key=permanent_s3_key, 
                    Body=direct_content_data.encode('utf-8'),
                    ContentType='text/plain'
                )

        # --- 5. HANDLE MULTIPLE FILE UPLOAD REQUEST (Presigned POST Authorization) ---
        upload_instructions = []
        file_keys_metadata = []
        
        if has_files:
            for filename in filenames:
                file_s3_key = f"{access_key}/{filename}"
                
                post_data = S3.generate_presigned_post(
                    Bucket=S3_BUCKET_NAME, Key=file_s3_key, Conditions=[], ExpiresIn=3600
                )
                
                upload_instructions.append({
                    'filename': filename, 'upload_url': post_data['url'], 'upload_fields': post_data['fields']
                })
                file_keys_metadata.append({'filename': filename, 's3_key': file_s3_key}) 

            item_to_save['Files'] = file_keys_metadata
            item_to_save['IsUploaded'] = False


        # --- 6. Finalize DynamoDB Write (Atomic Check & Cleanup) ---
        try:
            table.put_item(
                Item=item_to_save,
                ConditionExpression='attribute_not_exists(AccessKey)'
            )
            
            # SUCCESS: Now delete the temporary cache files
            cleanup_cache_files(cache_raw_key, cache_formatted_key)

            # ✅ Success Return
            response_body = {
                'message': f"{upload_mode} content stored successfully.",
                'key': access_key,
                'expires_at': expiry_time_epoch
            }
            if upload_instructions:
                response_body['upload_instructions'] = upload_instructions
                response_body['message'] = f"{upload_mode} authorization successful. Use Presigned POST for file uploads."
            
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps(response_body)
            }
            
        except ClientError as e:
            # Key conflict: Cleanup any files we just copied/created
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                if has_text_component: 
                    S3.delete_object(Bucket=S3_BUCKET_NAME, Key=permanent_s3_key)
                return {'statusCode': 409, 'headers': get_cors_headers(), 'body': json.dumps({'error': 'Custom key already in use.'})}
            raise

    except Exception as e:
        print(f"Error during storage: {e}")
        # Always attempt to clean up cache files on failure, if keys are present
        if cache_raw_key or cache_formatted_key:
             cleanup_cache_files(cache_raw_key, cache_formatted_key) 
             print("Cache files cleaned after storage failure.")
             
        return {'statusCode': 500,'headers': get_cors_headers(), 'body': json.dumps({'error': f'Internal server error during storage: {str(e)}'})}
