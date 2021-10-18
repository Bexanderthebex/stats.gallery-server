import { sql } from 'slonik';
import { Params } from './Params';

export default (params: Params) => {
  return sql`
    select count(*) as result
    where exists(
      select *
      from action_receipt_actions
      where action_kind = 'FUNCTION_CALL'
        and args ->> 'method_name' = 'nft_transfer'
        and args -> 'args_json' ->> 'receiver_id' = ${params.account_id}
    )
  `;
};
