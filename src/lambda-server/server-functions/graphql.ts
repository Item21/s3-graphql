import { ApolloServer, gql } from 'apollo-server-lambda';
import { Handler, Context, Callback, APIGatewayEvent } from 'aws-lambda'
import { checkHeaders } from '../helpers/checkHeaders';
import { abortMultipartUpload, completeMultipartUpload, getS3, getUrlsForParts, initS3Upload, listParts } from '../s3';
import { ServerContext } from '../s3/types';
 
const typeDefs = gql` 
  type File{
    id: ID
    path: String
    numParts: Int
    uploadId: String
  }
  type Part{
    PartNumber: Int
    size: Int
    ETag: String
  }
  input PartInput{
    PartNumber: Int
    size: Int
    ETag: String
  }  
    type GetUrlReturn{
      url: String!
    }
    type Query {
        file: File
        part: Part
        downloadGetUrl(fileKey: String!):GetUrlReturn
        prepareUploadParts(fileKey: String!, uploadId: String!, partNumber: Int!):GetUrlReturn
        listParts(fileKey: String!, uploadId: String!):Part
      }
    type CreateMultipartUploadReturn {
      uploadId: String!
      key: String!
    }
    type AbortMultipartUploadReturn {
      message: String!
    }
    type CompleteMultipartUploadReturn {
      location: String!
    }
    type Mutation {
      createMultipartUpload(fileKey: String!, metadata: String, numParts: Int):CreateMultipartUploadReturn
      abortMultipartUpload(fileKey: String!, uploadId: String!):AbortMultipartUploadReturn
      completeMultipartUpload(fileKey: String!, uploadId: String!,parts: [PartInput]):CompleteMultipartUploadReturn
    }
       
`;
type downloadGetUrlArgs ={
  fileKey: string
}
type prepareUploadPartsArgs = {
  fileKey: string
  uploadId: string 
  partNumber: number
}
type createMultipartUploadArgs = {
  fileKey: string,
  metadata: string,
  numParts: number
}
type uploadArgs = {
  uploadId: string,
  fileKey: string,
}
type part = {
  ETag: string,
  partNumber: number
}
type completeMultipartUploadArgs = {
  uploadId: string,
  fileKey: string,
  parts: part[]
}
const resolvers = {
  Query: {
    downloadGetUrl: async (parent: undefined, args: downloadGetUrlArgs, context: ServerContext) => {
      checkHeaders(context)
      const s3 = getS3(context)
      const fileKey = args.fileKey
      const url = await s3.getSignedUrlPromise('getObject', {
        Bucket: context.bucketName,
        Key: fileKey,
        Expires: context.urlExpiration,
      })
            const origin = new URL(url).origin//origin replace? minio specific?
      return {url}
    },
    prepareUploadParts: async (parent: undefined, args: prepareUploadPartsArgs, context: ServerContext) => {
      checkHeaders(context)
      const uploadId = args.uploadId
      const fileKey  = args.fileKey 
      const partNumber = args.partNumber
      const url = await getUrlsForParts(context, uploadId, fileKey, partNumber)
      const origin = new URL(url).origin //not sure replecament
      return {url}
    },
    listParts: async (parent: undefined, args: uploadArgs, context: ServerContext) => {
      checkHeaders(context)
      const uploadId = args.uploadId 
      const fileKey = args.fileKey
      const parts = await listParts(context, uploadId, fileKey )
      return {parts}
    },

  },
  Mutation: {
    createMultipartUpload: async (parent: undefined, args: createMultipartUploadArgs, context: ServerContext) => {
      checkHeaders(context)
      const fileKey = args.fileKey
      const metadata = args.metadata
      console.log(fileKey, metadata)
      const { uploadId, key } = await initS3Upload( context, fileKey, metadata )
      return { uploadId, key }
    },
    abortMultipartUpload: async (parent: undefined, args: uploadArgs, context: ServerContext) => {
      checkHeaders(context)
      const fileKey = args.fileKey
      const uploadId = args.uploadId
      let message = ''
      try {
        const parts = await listParts(context, uploadId, fileKey)
        do {
          await abortMultipartUpload(context, uploadId, fileKey)
        } while (parts.length > 0) {
          message = 'success'
          return {message}
        }
      } catch (error: any) {
        if (error.code === 'NoSuchUpload') {
          message = 'no such upload'
          return {message}
        }else{
          throw error
        } 

      }
    },
    completeMultipartUpload: async (parent: undefined, args: completeMultipartUploadArgs, context: ServerContext) => {
      checkHeaders(context)
      const fileKey = args.fileKey
      const uploadId = args.uploadId
      const parts = args.parts
      const location: string | undefined = await completeMultipartUpload(context, uploadId, fileKey, parts)
      return {location}
    }
  }
};


exports.handler = (
  event: APIGatewayEvent,
  context: Context,
  callback: Callback
) => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true,
    context:{
      accessKeyId: event.headers.accesskeyid,
      secretAccessKey: event.headers.secretaccesskey,
      region: event.headers.region,
      endpoint: event.headers.endpoint,
      skipSslVerify: event.headers.skipsslverify,
      bucketName: event.headers.bucketname,
      precreateBucket: event.headers.precreatebucket,
      urlExpiration: +event.headers.urlexpiration!,
    }
  });
  const serverHandler = server.createHandler()
  return serverHandler(
    {
      ...event,
      requestContext: event.requestContext || {},
    },
    context,
    callback
  );
}