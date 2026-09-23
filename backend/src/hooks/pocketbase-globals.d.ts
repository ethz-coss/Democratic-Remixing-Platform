declare const __hooks: string;
declare const $filepath: {
  join: (...parts: string[]) => string;
};
declare const $app: any;
declare const require: (id: string) => any;
declare const module: { exports: any };
declare const Record: new (collection: any) => any;
declare const $os: any;
declare const $http: any;

declare const BadRequestError: new (message: string) => Error;
declare const UnauthorizedError: new (message: string) => Error;
declare const ForbiddenError: new (message: string) => Error;
declare const NotFoundError: new (message: string) => Error;

declare namespace core {
    export type Record = any;
    export type RecordRequestEvent = any;
    export type ModelEvent = any;
}

declare function onRecordCreateRequest(handler: (e: any) => any, ...collections: string[]): void;
declare function onRecordUpdateRequest(handler: (e: any) => any, ...collections: string[]): void;
declare function onRecordDeleteRequest(handler: (e: any) => any, ...collections: string[]): void;
declare function onRecordAfterCreateSuccess(handler: (e: any) => any, ...collections: string[]): void;
declare function onRecordAfterUpdateSuccess(handler: (e: any) => any, ...collections: string[]): void;
declare function onRecordAfterDeleteSuccess(handler: (e: any) => any, ...collections: string[]): void;
declare function cronAdd(name: string, cronExpr: string, handler: () => void): void;
declare function routerAdd(method: string, path: string, handler: (e: any) => void): void;
