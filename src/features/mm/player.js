export default class Player {
    constructor(name, id, role) {
        this.name = name;
        this.id = id;
        this.role = role? role : 'guest';
        this.discovered = [];
    }
}