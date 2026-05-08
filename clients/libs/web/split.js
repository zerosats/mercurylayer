import axios from 'axios';

const postJson = async (clientConfig, path, payload) => {
  const response = await axios.post(`${clientConfig.statechainEntity}/${path}`, payload);
  return response.data;
};

const splitInit = async (clientConfig, payload) => {
  return await postJson(clientConfig, 'split/init', payload);
};

const splitFinalize = async (clientConfig, payload) => {
  return await postJson(clientConfig, 'split/finalize', payload);
};

const splitAbort = async (clientConfig, payload) => {
  return await postJson(clientConfig, 'split/abort', payload);
};

const getStatechainTree = async (clientConfig, statechainId) => {
  const response = await axios.get(`${clientConfig.statechainEntity}/info/statechain/${statechainId}/tree`);
  return response.data;
};

export default {
  splitInit,
  splitFinalize,
  splitAbort,
  getStatechainTree,
};
