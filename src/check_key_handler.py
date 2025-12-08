# src/check_key_handler.py
import json
import os
import boto3

# Initialize AWS clients
DYNAMODB = boto3.resource('dynamodb')

METADATA_TABLE_NAME = os.environ.get('METADATA_TABLE')

def get_cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': '*'
    }

def lambda_handler(event, context):
    """
    Handles GET /checkkey/{key} request. Checks if the AccessKey exists.
    """
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': '' 
        }
        
    table = DYNAMODB.Table(METADATA_TABLE_NAME)
    
    try:
        # Key comes from path parameter
        access_key = event['pathParameters']['key'].upper()
        
        # Use DynamoDB.get_item for fastest, cheapest read (Eventual Consistency is fine here)
        response = table.get_item(
            Key={'AccessKey': access_key},
            ProjectionExpression='AccessKey' # Minimal data read
        )
        
        if response.get('Item'):
            # Key exists (409 Conflict - custom to signal conflict)
            return {
                'statusCode': 409,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': f'Key "{access_key}" is already taken.'})
            }
        else:
            # Key is available (200 OK)
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({'message': f'Key "{access_key}" is available.'})
            }

    except Exception as e:
        print(f"Error checking key availability: {e}")
        # Return 500 for unhandled internal errors
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error during key check.'})
        }