import AWS from 'aws-sdk';


export const s3 = new AWS.S3({
  accessKeyId: 'GLZG2JTWDFFSCQVE7TSQ',
  secretAccessKey: 'VjTXOpbhGvYjDJDAt2PNgbxPKjYA4p4B7Btmm4Tw',
  endpoint: 'http://192.168.180.9:8000/',
  s3ForcePathStyle: true
});

export function uploadJson(path, obj, indent, Bucket = 'ai-pipeline-statistics') {
  return new Promise((r, reject) => {
    s3.upload({
      Bucket,
      Key: path,
      Body: JSON.stringify(obj, null, indent),
      ContentType: 'application/json',
    }, (err, res) => {
      if (err) return reject(err);
      r(res);
    });
  });
}

export function uploadBuffer(path, buffer, content_type, Bucket = 'ai-pipeline-statistics') {
  return new Promise((r, reject) => {
    s3.upload({
      Bucket,
      Key: path,
      Body: buffer,
      ContentType: content_type
    }, (err, res) => {
      if (err) return reject(err);
      r(res);
    });
  });
}

export function getJson(path, Bucket = 'ai-pipeline-statistics') {
  return new Promise((r) => {
    s3.getObject({
      Bucket,
      Key: path
    }, (err, res) => {
      if (err) return r(null);
      try {
        res.Body = JSON.parse(res.Body);
      } catch (error) {
        res.Body = null;
      }
      r(res);
    });
  });
}
export function getObject(path, Bucket = 'ai-pipeline-statistics') {
  return new Promise((r, reject) => {
    s3.getObject({
      Bucket,
      Key: path
    }, (err, res) => {
      if (err) return reject(err);
      console.log(res);
      r(res);
    });
  });
}
