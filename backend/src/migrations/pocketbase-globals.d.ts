declare const migrate: (up: (txApp: any) => void, down: (txApp: any) => void) => void;
declare const Dao: new (app: any) => any;
declare const Collection: new (payload: any) => any;
declare const Field: new (payload: any) => any;
